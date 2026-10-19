const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const F = require('../follows');

test('runner persists processing before clicking, stops on blocked results, and never retries interrupted items', async () => {
  const elements = new Map(), log = [];
  const element = () => ({ value: '', textContent: '', addEventListener() {}, append() {}, replaceChildren() {} });
  const entries = [
    { ...F.profile('interrupted'), status: 'processing' },
    { ...F.profile('alice'), status: 'pending' },
    { ...F.profile('bob'), status: 'pending' }
  ];
  const context = vm.createContext({
    URLSearchParams, location: { search: '?project=default' }, HighlightextFollows: F,
    navigator: { locks: {} }, setTimeout: fn => fn(), followXProfile: () => {},
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element },
    chrome: {
      runtime: { sendMessage: async message => {
        if (message.type === 'getState') return { config: { projects: { default: { name: 'Default' } } } };
        if (message.type === 'follow:update') {
          log.push(message.status); Object.assign(entries.find(entry => entry.key === message.key), { status: message.status });
        }
        return { entries: structuredClone(entries) };
      } },
      tabs: {
        create: async ({ url }) => { log.push(url); return { id: 7 }; },
        get: async () => ({ status: 'complete' })
      },
      scripting: { executeScript: async () => { log.push('click'); return [{ result: { status: 'blocked', detail: 'Login needed' } }]; } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../follow.js'), 'utf8'), context);
  await vm.runInContext('runQueue()', context);
  assert.deepEqual(log, ['processing', 'https://x.com/alice', 'click', 'blocked']);
  assert.equal(entries[0].status, 'processing');
  assert.equal(entries[2].status, 'pending');
  assert.equal(elements.get('error').textContent, 'Login needed');
});
