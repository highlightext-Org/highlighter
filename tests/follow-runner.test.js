const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const F = require('../follows');

test('runner persists processing before clicking, stops on blocked results, and never retries interrupted items', async () => {
  const elements = new Map(), log = [];
  const element = () => ({ value: '', textContent: '', addEventListener() {}, setAttribute() {}, append() {}, replaceChildren() {} });
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

for (const outcome of ['matched', 'skipped', 'blocked', 'stopped', 'navigated']) {
  test(`location-gated runner handles ${outcome} without bypassing the check`, async () => {
    const elements = new Map(), log = [];
    const element = () => ({ value: '', textContent: '', addEventListener() {}, setAttribute() {}, append() {}, replaceChildren() {} });
    const entries = [{ ...F.profile('alice'), status: 'pending' }];
    let tabURL, saved;
    const requirements = { basedIn: 'United States', connectedVia: 'United States App Store' };
    const context = vm.createContext({
      URL, URLSearchParams, location: { search: '?project=default' }, HighlightextFollows: F,
      navigator: { locks: {} }, setTimeout: fn => fn(),
      followXProfile: function followXProfile() {}, checkXRequirements: function checkXRequirements() {},
      document: { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element },
      chrome: {
        runtime: { sendMessage: async message => {
          if (message.type === 'getState') return { config: { projects: { default: { name: 'Default' } } } };
          if (message.type === 'follow:requirements') saved = message.requirements;
          if (message.type === 'follow:update') {
            log.push(message.status);
            Object.assign(entries[0], { status: message.status, detail: message.detail });
          }
          return { entries: structuredClone(entries), requirements };
        } },
        tabs: {
          create: async ({ url }) => { tabURL = url; return { id: 7 }; },
          update: async (id, { url }) => { log.push('return-profile'); tabURL = url; return { id }; },
          get: async () => ({ status: 'complete', url: tabURL })
        },
        scripting: { executeScript: async ({ func, args }) => {
          if (func.name === 'checkXRequirements') {
            log.push('check');
            assert.equal(entries[0].status, 'processing');
            assert.equal(args[0], 'alice');
            assert.equal(args[1].connectedVia, requirements.connectedVia);
            tabURL = outcome === 'navigated' ? 'https://x.com/bob/about' : 'https://x.com/alice/about';
            if (outcome === 'stopped') vm.runInContext('stopRequested = true', context);
            return [{ result: { status: ['stopped', 'navigated'].includes(outcome) ? 'matched' : outcome, detail: 'Location result' } }];
          }
          log.push('follow');
          assert.equal(tabURL, 'https://x.com/alice');
          return [{ result: { status: 'followed', detail: 'Confirmed.' } }];
        } }
      }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../follow.js'), 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    await vm.runInContext('runQueue()', context);
    assert.equal(saved.basedIn, 'United States');
    assert.deepEqual(log, outcome === 'matched'
      ? ['processing', 'check', 'return-profile', 'follow', 'followed']
      : ['processing', 'check', outcome === 'skipped' ? 'skipped' : 'blocked']);
    if (outcome === 'matched') assert.match(entries[0].detail, /Location result/);
  });
}
