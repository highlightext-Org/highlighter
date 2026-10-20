const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../diagnostics'), 'utf8');

test('diagnostics streams only the active request, caps the log, copies and clears', async () => {
  let receive, copied;
  const nodes = {};
  const node = id => nodes[id] ||= { textContent: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } };
  const context = vm.createContext({
    crypto: { randomUUID: () => 'active-run' },
    document: { getElementById: node }, window: { addEventListener() {} },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    chrome: { runtime: { getManifest: () => ({ version: '0.3.1' }), onMessage: { addListener: fn => { receive = fn; } } } }
  });
  vm.runInContext(source, context);
  const api = context.HextDiagnostics;
  api.begin();
  const event = { target: 'hext-diagnostics', requestId: 'other-run', entry: { time: new Date().toISOString(), level: 'info', stage: 'api', message: 'HTTP 200' } };
  receive(event, {});
  assert(!node('diagnostic-output').textContent.includes('HTTP 200'));
  receive({ ...event, requestId: 'active-run' }, { tab: { id: 1 } });
  assert(!node('diagnostic-output').textContent.includes('HTTP 200'));
  receive({ ...event, requestId: 'active-run' }, {});
  assert(node('diagnostic-output').textContent.includes('HTTP 200'));
  for (let i = 0; i < 250; i++) api.write('step', `Step ${i}`);
  assert.equal(node('diagnostic-count').textContent, '200 entries');
  await node('diagnostic-copy').handlers.click();
  assert.equal(copied, node('diagnostic-output').textContent);
  node('diagnostic-clear').handlers.click();
  assert.equal(node('diagnostic-output').textContent, '');
});

test('closing a panel does not fail background operations that publish progress', async () => {
  const context = vm.createContext({ chrome: { runtime: { sendMessage: async () => { throw new Error('no receiver'); } } } });
  vm.runInContext(source, context);
  assert.doesNotThrow(() => context.HextDiagnostics.write('api', 'Sending correction.', 'info', 'run-1'));
  await new Promise(setImmediate);
});
