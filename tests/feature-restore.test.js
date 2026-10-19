const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(setImmediate);

function boot(stored, { rejectTab = false } = {}) {
  const injected = [], events = {}, writes = [];
  const event = name => ({ addListener: fn => { events[name] = fn; } });
  const context = vm.createContext({
    chrome: {
      runtime: { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
      permissions: { onAdded: event('permission') },
      alarms: { onAlarm: event('alarm'), create: async () => {}, clear: async () => {} },
      tabs: { query: async () => [{ id: 5 }, { id: 6 }] },
      scripting: { executeScript: async details => {
        injected.push(details);
        if (rejectTab && details.target.tabId === 5) throw new Error('Restricted tab');
      } },
      storage: { local: {
        get: async keys => Object.fromEntries(keys.filter(key => key in stored).map(key => [key, structuredClone(stored[key])])),
        set: async values => { writes.push(values); Object.assign(stored, structuredClone(values)); }
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background'), 'utf8'), context);
  return { events, injected, writes };
}
const saved = () => ({ config: { activeProject: 'campaign', autoHighlight: false, autoLikeX: true, autoFollowX: true,
  projects: { campaign: { name: 'Campaign', rules: [{ text: 'keep me' }] } } }, aiSettings: { provider: 'openai', openai: { apiKey: 'test-key' } } });

test('background reload restores enabled hover features on existing tabs without any settings writes or toggle clicks', async () => {
  const stored = saved(), before = structuredClone(stored);
  for (let reload = 0; reload < 2; reload++) {
    const app = boot(stored); await tick();
    assert.deepEqual(app.injected.map(item => item.files[0]).sort(), ['auto-follow-content.js', 'auto-follow-content.js', 'auto-like-content.js', 'auto-like-content.js']);
    assert.equal(app.writes.length, 0);
    assert.deepEqual(stored, before);
  }
});

test('browser startup, updates, and restored permissions reattach saved enabled features', async () => {
  const app = boot(saved()); await tick();
  for (const name of ['startup', 'installed', 'permission']) {
    app.injected.length = 0;
    await app.events[name]();
    assert.equal(app.injected.length, 4);
  }
});

test('disabled choices stay disabled after reload and restored highlighting respects its saved toggle', async () => {
  const stored = saved(); stored.config.autoLikeX = false; stored.config.autoFollowX = false;
  const disabled = boot(stored); await tick(); assert.equal(disabled.injected.length, 0);
  stored.config.autoHighlight = true;
  const highlighting = boot(stored); await tick();
  assert.deepEqual(highlighting.injected.map(item => item.files[0]), ['content.js', 'content.js']);
});

test('a tab rejecting injection does not prevent restoration in the other tabs or features', async () => {
  const app = boot(saved(), { rejectTab: true }); await tick();
  assert.equal(app.injected.filter(item => item.target.tabId === 6).length, 2);
  await app.events.startup();
  assert.equal(app.injected.filter(item => item.target.tabId === 6).length, 4);
});
