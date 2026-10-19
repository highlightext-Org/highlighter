const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function setup({ key = true, firefox = false, consent = true } = {}) {
  const nodes = {}, calls = [];
  let response = async () => ({ corrected_text: 'My spelling is better.' }), inClick = false;
  const settings = { provider: 'openai', providers: { openai: { hasKey: key, model: 'gpt-4.1-mini' }, anthropic: { hasKey: false, model: 'claude-haiku-4-5' } } };
  const node = id => nodes[id] ||= {
    value: id === 'text' ? 'my speling is beter.' : '', hidden: false, disabled: false, dataset: {}, handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.(event); }, focus() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../ai-ui'), 'utf8'), {
    Event: class { constructor(type) { this.type = type; } },
    document: { getElementById: node },
    chrome: {
      runtime: {
        getManifest: () => firefox ? { browser_specific_settings: { gecko: { data_collection_permissions: { optional: ['authenticationInfo', 'personalCommunications'] } } } } : {},
        sendMessage: async message => {
          calls.push(message);
          if (message.type === 'ai:settings') return structuredClone(settings);
          if (message.type === 'ai:save') { settings.provider = message.provider; settings.providers[message.provider].hasKey = !message.removeKey; return structuredClone(settings); }
          return response();
        }
      },
      permissions: { request: async () => { assert(inClick, 'Firefox consent must be requested within the click'); return consent; } }
    }
  });
  await new Promise(setImmediate);
  return {
    node, calls,
    respond: fn => { response = fn; },
    edit(text) { node('text').value = text; node('text').dispatchEvent({ type: 'input' }); },
    async click(id) { inClick = true; const pending = node(id).handlers.click(); inClick = false; await pending; }
  };
}

test('correction updates the editor and Undo restores the exact original text', async () => {
  const app = await setup();
  await app.click('ai-correct');
  assert.equal(app.node('text').value, 'My spelling is better.');
  assert.equal(app.node('ai-undo').hidden, false);
  await app.click('ai-undo');
  assert.equal(app.node('text').value, 'my speling is beter.');
  assert.equal(app.node('ai-undo').hidden, true);
  assert.equal(app.node('ai-correct').disabled, false);
});

test('typing during an API request preserves edits and typing after correction clears Undo', async () => {
  const app = await setup(); let release;
  app.respond(() => new Promise(resolve => { release = resolve; }));
  const pending = app.click('ai-correct');
  app.edit('My newer draft'); release({ corrected_text: 'Old result' }); await pending;
  assert.equal(app.node('text').value, 'My newer draft');
  assert.match(app.node('ai-status').textContent, /edits were kept/);
  app.respond(async () => ({ corrected_text: 'New corrected draft' })); await app.click('ai-correct');
  app.edit('More typing'); assert.equal(app.node('ai-undo').hidden, true);
});

test('errors leave text intact and restore controls; missing keys open settings without calling the API', async () => {
  const app = await setup();
  app.respond(async () => ({ error: 'API error' })); await app.click('ai-correct');
  assert.equal(app.node('text').value, 'my speling is beter.');
  assert.equal(app.node('ai-status').dataset.error, 'true');
  assert.equal(app.node('ai-correct').disabled, false);
  const missing = await setup({ key: false }); await missing.click('ai-correct');
  assert.equal(missing.node('ai-settings').open, true);
  assert(!missing.calls.some(call => call.type === 'ai:correct'));
});

test('Firefox consent is requested from the click and denial prevents an API call', async () => {
  const app = await setup({ firefox: true, consent: false }); await app.click('ai-correct');
  assert(!app.calls.some(call => call.type === 'ai:correct'));
  assert.equal(app.node('text').value, 'my speling is beter.');
  const allowed = await setup({ firefox: true }); await allowed.click('ai-correct');
  assert.equal(allowed.node('text').value, 'My spelling is better.');
});

test('saving and removing keys clears the key input and does not restore a removed secret', async () => {
  const app = await setup(); app.node('ai-key').value = 'test-key';
  await app.click('ai-save'); assert.equal(app.node('ai-key').value, '');
  await app.click('ai-remove'); assert.equal(app.node('ai-remove').disabled, true);
  assert.match(app.node('ai-key-status').textContent, /No key/);
});
