const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ firefox = false, consent = true, timers } = {}) {
  const stored = {}, calls = [], logs = [];
  let respond = async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"corrected_text":"My spelling is better."}' }] }] }) });
  const context = vm.createContext({
    HextDiagnostics: { write: (stage, message, level, requestId) => logs.push({ stage, message, level, requestId }) },
    AbortSignal, AbortController, setTimeout: timers?.setTimeout || setTimeout, clearTimeout: timers?.clearTimeout || clearTimeout,
    chrome: {
      runtime: { getManifest: () => firefox ? { browser_specific_settings: { gecko: { data_collection_permissions: { optional: ['authenticationInfo', 'personalCommunications'] } } } } : {} },
      permissions: { contains: async () => consent },
      storage: { local: {
        get: async () => structuredClone(stored),
        set: async values => Object.assign(stored, structuredClone(values))
      } }
    },
    fetch: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return respond(); }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../ai'), 'utf8'), context);
  return { stored, calls, logs, send: message => context.HighlightextAI.handle(message), respond: fn => { respond = fn; } };
}
const save = (app, provider = 'openai', extra = {}) => app.send({ type: 'ai:save', provider, apiKey: `test-${provider}-key`, ...extra });
const correct = app => app.send({ type: 'ai:correct', text: 'my speling is beter.' });

test('AI keys persist separately by provider and public settings never expose credentials', async () => {
  const app = setup();
  assert.equal((await app.send({ type: 'ai:settings' })).providers.openai.hasKey, false);
  await save(app); await save(app, 'anthropic');
  let settings = await app.send({ type: 'ai:save', provider: 'openai', apiKey: '', model: 'gpt-4.1-mini' });
  assert.equal(settings.provider, 'openai');
  assert.equal(settings.providers.openai.hasKey, true);
  assert.equal(settings.providers.anthropic.hasKey, true);
  assert(!JSON.stringify(settings).includes('test-'));
  assert.equal(app.stored.aiSettings.openai.apiKey, 'test-openai-key');
  settings = await app.send({ type: 'ai:save', provider: 'openai', removeKey: true });
  assert.equal(settings.providers.openai.hasKey, false);
  assert.equal(settings.providers.anthropic.hasKey, true);
  assert.equal(app.stored.aiSettings.openai.apiKey, '');
  await assert.rejects(save(app, 'unknown'), /Choose/);
  await assert.rejects(save(app, 'openai', { apiKey: 'bad key' }), /spaces/);
  await assert.rejects(save(app, 'openai', { model: '../bad' }), /model ID/);
});

test('OpenAI uses Responses strict JSON Schema, no storage, fixed endpoint and bearer authentication', async () => {
  const app = setup(); await save(app);
  const result = await correct(app);
  assert.equal(result.corrected_text, 'My spelling is better.');
  const call = app.calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.headers.Authorization, 'Bearer test-openai-key');
  assert.equal(call.redirect, 'error');
  assert.equal(call.body.store, false);
  assert.equal(call.body.text.format.strict, true);
  assert.equal(call.body.text.format.schema.additionalProperties, false);
  assert.deepEqual(call.body.text.format.schema.required, ['corrected_text']);
  assert.equal(JSON.parse(call.body.input[0].content).text, 'my speling is beter.');
});

test('Anthropic uses Messages output_config schema with the same validated result', async () => {
  const app = setup(); await save(app, 'anthropic');
  app.respond(async () => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"corrected_text":"My spelling is better."}' }] }) }));
  assert.equal((await correct(app)).corrected_text, 'My spelling is better.');
  const call = app.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'test-anthropic-key');
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.equal(call.body.output_config.format.schema.additionalProperties, false);
  assert.equal(call.body.model, 'claude-haiku-4-5');
});

test('invalid JSON and invalid correction shapes are rejected without fallback parsing', async () => {
  const app = setup(); await save(app);
  for (const text of ['```json\n{}\n```', '{', 'null', '[]', '{"corrected_text":4}', '{"corrected_text":""}', '{"corrected_text":"x","extra":1}', JSON.stringify({ corrected_text: 'x'.repeat(40001) })]) {
    app.respond(async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }) }));
    await assert.rejects(correct(app), /JSON|format/);
  }
});

test('refusals, incomplete results, and malformed envelopes are rejected for both providers', async () => {
  const app = setup();
  for (const [provider, payloads] of [
    ['openai', [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, { status: 'incomplete', output: [] }, { status: 'completed', output: [] }, { output: {} }, null]],
    ['anthropic', [{ stop_reason: 'refusal' }, { stop_reason: 'max_tokens' }, { stop_reason: 'end_turn', content: [] }, { stop_reason: 'end_turn', content: {} }, null]]
  ]) {
    await save(app, provider);
    for (const data of payloads) {
      app.respond(async () => ({ ok: true, json: async () => data }));
      await assert.rejects(correct(app), /declined|incomplete|no correction|unexpected/);
    }
  }
});

test('API errors, invalid response JSON, timeout and network failures are safe and release the request lock', async () => {
  const app = setup(); await save(app);
  for (const code of [400, 401, 403, 404, 429, 500]) {
    app.respond(async () => ({ ok: false, status: code, json: async () => { throw new Error('should not read secrets'); } }));
    await assert.rejects(correct(app), new RegExp(`HTTP ${code}`));
  }
  for (const name of ['TimeoutError', 'TypeError']) {
    app.respond(async () => { const e = new Error('secret'); e.name = name; throw e; });
    await assert.rejects(correct(app), /timed out|Could not reach/);
  }
  app.respond(async () => ({ ok: true, json: async () => { throw new Error('secret'); } }));
  await assert.rejects(correct(app), /unreadable/);
});

test('empty input, missing keys, denied Firefox consent and concurrent requests make no extra API calls', async () => {
  const app = setup();
  await assert.rejects(correct(app), /API key/);
  await save(app);
  for (const text of ['', ' ', 3, 'x'.repeat(20001)]) await assert.rejects(app.send({ type: 'ai:correct', text }), /characters/);
  assert.equal(app.calls.length, 0);
  let release;
  app.respond(() => new Promise(resolve => { release = resolve; }));
  const first = correct(app); await new Promise(setImmediate);
  await assert.rejects(correct(app), /already running/);
  assert.equal(app.calls.length, 1);
  release({ ok: false, status: 500 }); await assert.rejects(first);
  const denied = setup({ firefox: true, consent: false }); await save(denied);
  await assert.rejects(correct(denied), /data access/);
  assert.equal(denied.calls.length, 0);
});


test('stalled provider fetches and response bodies time out, abort, and release the correction lock', async () => {
  const pending = new Map(); let serial = 0;
  const app = setup({ timers: {
    setTimeout(callback) { const id = ++serial; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); }
  } });
  await save(app);
  for (const phase of ['fetch', 'body']) {
    app.respond(() => phase === 'fetch' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
    const request = correct(app);
    await new Promise(setImmediate);
    const signal = app.calls.at(-1).signal;
    for (const callback of [...pending.values()]) callback();
    await assert.rejects(request, /timed out/);
    assert.equal(signal.aborted, true);
    assert.equal(pending.size, 0);
    app.respond(async () => ({ ok: false, status: 404 }));
    await assert.rejects(correct(app), /model was not found or your API project cannot access it/);
    assert.equal(pending.size, 0);
  }
});


test('background logs API progress for the requesting panel without keys or correction text', async () => {
  const app = setup(); await save(app);
  await app.send({ type: 'ai:correct', text: 'private draft', requestId: 'run-1' });
  assert(app.logs.some(row => row.message.includes('HTTP 200')));
  assert(app.logs.some(row => row.stage === 'response'));
  assert(app.logs.every(row => row.requestId === 'run-1'));
  const log = JSON.stringify(app.logs);
  for (const value of ['private draft', 'test-openai-key', 'My spelling is better.']) assert(!log.includes(value));
});
