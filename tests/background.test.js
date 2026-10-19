const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Rules = require('../definitions');
const Matcher = require('../matcher');
const Timeline = require('../timeline');
function setup(data = { rules: [{ id: 'risk', text: 'risk', category: 'QA' }] }) {
  const stored = {}, alarms = new Map(); let listener, fail = false, downloads = 0, failTimelineWrites = false;
  const context = vm.createContext({
    AbortSignal, HighlightextRules: Rules, Highlightext: Matcher, HighlightextTimeline: Timeline, HighlightextFollows: require('../follows'), URL, crypto: require('node:crypto').webcrypto,
    fetch: async () => { downloads++; if (fail) throw new Error('Offline test'); return { ok: true, json: async () => data }; },
    runMatchJob: async job => ({ results: job.texts.map(text => Matcher.createMatcher(job.rules, job.options)(text)), capped: false }),
    chrome: {
      tabs: { query: async () => [{ id: 5 }], create: async ({ url }) => ({ id: 6, url }), update: async (id, value) => ({ id, ...value }) },
      scripting: { executeScript: async () => [] },
      runtime: { getURL: file => `moz-extension://test/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
      alarms: { onAlarm: { addListener() {} }, create: async (id, options) => alarms.set(id, options), clear: async id => alarms.delete(id) },
      storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in stored).map(key => [key, structuredClone(stored[key])])),
        set: async values => {
          if (failTimelineWrites && values.timelineRecords) throw new Error('Storage quota exceeded');
          Object.assign(stored, structuredClone(values));
        }
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background'), 'utf8'), context);
  return { stored, alarms, downloads: () => downloads, offline: () => { fail = true; }, failTimelineWrites: () => { failTimelineWrites = true; }, send: (message, sender = {}) => new Promise(resolve => listener(message, sender, resolve)) };
}

test('sync cache preserves last success and visible errors across offline requests', async () => {
  const app = setup();
  const first = await app.send({ type: 'loadTerms' }); assert.equal(first.terms.length, 1);
  app.offline(); const offline = await app.send({ type: 'loadTerms', force: true });
  assert.equal(offline.ok, false); assert.equal(offline.terms[0].id, 'risk'); assert.equal(offline.updatedAt, first.updatedAt);
  const cached = await app.send({ type: 'loadTerms' }); assert.equal(cached.syncError, 'Offline test'); assert.equal(app.downloads(), 2);
});

test('old cached definitions refresh once and a 674-pattern master can save and scan', async () => {
  const keywords = Array.from({ length: 674 }, (_, i) => ({ text: `(?i)\\bplace[\\s-]*${i}\\b`, match_mode: 'regex' }));
  const app = setup({ schema_version: 1, keywords, profiles: [] });
  app.stored.remoteRules = [Rules.normalizeRule({ text: keywords[0].text })];
  app.stored.updatedAt = Date.now();
  app.stored.definitionsVersion = 2;
  const loaded = await app.send({ type: 'loadTerms' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.terms.length, 674);
  assert(loaded.terms.every(rule => rule.type === 'regex'));
  assert.equal((await app.send({ type: 'saveConfig', config: loaded.config })).ok, true);
  const scan = await app.send({ type: 'scan', texts: ['PLACE-225 place 0'] });
  assert.equal(scan.results[0].length, 2);
  await app.send({ type: 'loadTerms' });
  assert.equal(app.downloads(), 1);
  loaded.config.projects.default.rules = Array.from({ length: Matcher.MAX_REGEX_RULES + 1 }, (_, i) =>
    ({ id: `local-${i}`, text: `custom${i}`, type: 'regex' }));
  assert.match((await app.send({ type: 'saveConfig', config: loaded.config })).error, /at most 1000/);
});

test('project settings and daily alarms persist; page records are isolated, deduplicated and optional', async () => {
  const app = setup(); const initial = await app.send({ type: 'loadTerms' });
  const config = initial.config; config.autoRefresh = true; config.projects.default.recordMatches = true;
  config.projects.campaign = { name: 'Campaign', rules: [], overrides: { risk: { enabled: false } }, options: {} };
  await app.send({ type: 'saveConfig', config }); assert(app.alarms.has('definitions-sync'));
  const sender = { tab: { id: 5, url: 'https://x.com/test' }, url: 'https://x.com/test' };
  const scan = { type: 'scan', texts: ['risk risk'], projectId: 'default' };
  assert.equal((await app.send(scan, sender)).results[0].length, 2);
  await app.send(scan, sender);
  let { records } = await app.send({ type: 'getRecords', projectId: 'default' });
  assert.equal(records.length, 2); assert.equal(records[0].platform, 'X'); assert.equal(records[0].category, 'QA'); assert.equal(records[0].sourceUrl, sender.url);
  assert.equal((await app.send({ ...scan, projectId: 'campaign' }, sender)).results[0].length, 0);
  assert.equal((await app.send({ type: 'getRecords', projectId: 'campaign' })).records.length, 0);
  config.autoRefresh = false; await app.send({ type: 'saveConfig', config }); assert(!app.alarms.has('definitions-sync'));
  await app.send({ type: 'clearRecords', projectId: 'default' }); assert.equal((await app.send({ type: 'getRecords', projectId: 'default' })).records.length, 0);
  assert.match((await app.send({ type: 'saveConfig', config }, sender)).error, /extension/);
});

test('invalid configuration and oversized scans never activate', async () => {
  const app = setup(); const { config } = await app.send({ type: 'loadTerms' });
  config.projects.default.rules = [{ id: 'bad', text: '[', type: 'regex' }];
  assert((await app.send({ type: 'saveConfig', config })).error);
  assert.equal(app.stored.config, undefined);
  assert.match((await app.send({ type: 'scan', texts: ['x'.repeat(200001)] })).error, /limit/);
});

test('timeline recording persists without UI, deduplicates, exports, stops, and clears by project', async () => {
  const app = setup();
  const { config } = await app.send({ type: 'getState' });
  config.projects.other = { name: 'Other', rules: [], options: {} };
  assert.equal((await app.send({ type: 'saveConfig', config })).ok, true);
  const sender = { tab: { id: 5 }, frameId: 0, url: 'https://x.com/home' };
  const batch = id => ({ type: 'timeline:capture', sessionId: id, entries: [
    { text: 'A post with no matching keyword', author: '@alice', postUrl: 'https://x.com/alice/status/123?tracking=1' }
  ] });
  const started = await app.send({ type: 'timeline:start', projectId: 'default' });
  const token = started.session.id;
  assert.equal(started.session.active, true);
  assert.equal((await app.send(batch(token), sender)).active, true);
  await app.send(batch(token), sender);
  let result = await app.send({ type: 'timeline:export', projectId: 'default' });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].postUrl, 'https://x.com/alice/status/123');
  assert.equal(result.records[0].key, undefined);
  assert.equal((await app.send({ type: 'timeline:export', projectId: 'other' })).records.length, 0);
  const pageStatus = await app.send({ type: 'timeline:status' }, sender);
  assert.equal(pageStatus.session.id, token);
  assert.equal(pageStatus.records, undefined);
  // Storage is the source of truth, including after the background worker is restarted.
  const restarted = setup(); Object.assign(restarted.stored, structuredClone(app.stored));
  assert.equal((await restarted.send({ type: 'timeline:status', projectId: 'default' })).count, 1);
  await app.send({ type: 'timeline:stop', projectId: 'default' });
  assert.equal((await app.send(batch(token), sender)).active, false);
  assert.equal((await app.send({ type: 'timeline:export', projectId: 'default' })).records.length, 1);
  const other = await app.send({ type: 'timeline:start', projectId: 'other' });
  await app.send(batch(other.session.id), sender);
  await app.send({ type: 'timeline:clear', projectId: 'default' });
  assert.equal((await app.send({ type: 'timeline:status', projectId: 'other' })).session.active, true);
  assert.equal((await app.send({ type: 'timeline:export', projectId: 'other' })).records.length, 1);
  await app.send({ type: 'timeline:clear', projectId: 'other' });
  assert.equal((await app.send(batch(other.session.id), sender)).active, false);
  result = await app.send({ type: 'timeline:status', projectId: 'other' });
  assert.equal(result.session.active, false); assert.equal(result.total, 0);
});

test('timeline captures reject unsupported sites, frames, oversized batches, and page management requests', async () => {
  const app = setup();
  const sender = { tab: { id: 5 }, frameId: 0, url: 'https://www.instagram.com/' };
  assert.match((await app.send({ type: 'timeline:start', projectId: 'default' }, sender)).error, /extension/);
  assert.match((await app.send({ type: 'timeline:export', projectId: 'default' }, sender)).error, /extension/);
  assert.match((await app.send({ type: 'timeline:status' }, { ...sender, url: 'https://evil.example/' })).error, /supports/);
  const start = await app.send({ type: 'timeline:start', projectId: 'default' });
  const capture = { type: 'timeline:capture', sessionId: start.session.id, entries: [{ text: 'caption' }] };
  assert.match((await app.send(capture, { ...sender, frameId: 3 })).error, /supported page/);
  assert.match((await app.send({ ...capture, entries: Array(101).fill({ text: 'x' }) }, sender)).error, /too large/);
  assert.match((await app.send({ ...capture, entries: [{ text: 'x'.repeat(1500001) }] }, sender)).error, /too large/);
  assert.match((await app.send({ type: 'timeline:start', projectId: 'missing' })).error, /valid project/);
});

test('timeline storage failure stops recording with a persistent visible error', async () => {
  const app = setup();
  const { session } = await app.send({ type: 'timeline:start', projectId: 'default' });
  app.failTimelineWrites();
  const result = await app.send({ type: 'timeline:capture', sessionId: session.id, entries: [{ text: 'post' }] },
    { tab: { id: 5 }, frameId: 0, url: 'https://x.com/home' });
  assert.match(result.error, /Storage quota/);
  const status = await app.send({ type: 'timeline:status', projectId: 'default' });
  assert.equal(status.session.active, false);
  assert.match(status.session.error, /Recording stopped/);
});


test('follow queues validate and deduplicate imports, persist outcomes, and isolate projects', async () => {
  const app = setup();
  const state = await app.send({ type: 'getState' });
  state.config.projects.other = { name: 'Other', rules: [], options: {} };
  await app.send({ type: 'saveConfig', config: state.config });
  const send = (type, extra = {}) => app.send({ type: `follow:${type}`, projectId: 'default', ...extra });
  let result = await send('add', { text: '@Alice https://twitter.com/alice instagram:bob https://evil.example/a', platform: 'x' });
  assert.equal(result.added, 2); assert.equal(result.duplicates, 1); assert.equal(result.errors.length, 1);
  result = await send('add', { text: '@alice', platform: 'x' });
  assert.equal(result.added, 0); assert.equal(result.duplicates, 1);
  await send('update', { key: 'x:alice', status: 'processing' });
  assert.equal((await send('list')).entries[0].status, 'processing');
  await send('clear'); assert.equal((await send('list')).entries.length, 2);
  await send('update', { key: 'x:alice', status: 'followed' });
  await send('clear'); assert.equal((await send('list')).entries.length, 1);
  assert.equal((await app.send({ type: 'follow:list', projectId: 'other' })).entries.length, 0);
  assert.match((await send('update', { key: 'instagram:bob', status: 'invented' })).error, /Invalid queue status/);
  assert.match((await app.send({ type: 'follow:list', projectId: 'missing' })).error, /existing project/);
  const sender = { tab: { id: 2 }, url: 'https://x.com/alice' };
  const denied = await app.send({ type: 'follow:list', projectId: 'default' }, sender);
  assert.match(denied.error, /Open the extension/);
});

test('automatic highlighting defaults on, persists off, and exposes only page settings', async () => {
  const app = setup();
  const sender = { tab: { id: 5 }, url: 'https://example.com/' };
  const initial = await app.send({ type: 'hext:settings' }, sender);
  assert.equal(initial.enabled, true);
  assert.equal(initial.projectId, 'default');
  assert.equal(initial.config, undefined);
  assert.equal(app.downloads(), 1);
  const { config } = await app.send({ type: 'getState' });
  config.autoHighlight = false;
  assert.equal((await app.send({ type: 'saveConfig', config })).ok, true);
  assert.equal((await app.send({ type: 'hext:settings' }, sender)).enabled, false);
  const restarted = setup(); Object.assign(restarted.stored, structuredClone(app.stored));
  assert.equal((await restarted.send({ type: 'hext:settings' }, sender)).enabled, false);
  assert.equal(restarted.downloads(), 0);
  config.autoHighlight = true;
  assert.equal((await app.send({ type: 'saveConfig', config })).ok, true);
  assert.equal((await app.send({ type: 'hext:settings' }, sender)).enabled, true);
});

test('follow requirements persist by project, validate before saving, and default to optional', async () => {
  const app = setup();
  const { config } = await app.send({ type: 'getState' });
  config.projects.other = { name: 'Other', rules: [], options: {} };
  await app.send({ type: 'saveConfig', config });
  const send = (type, extra = {}) => app.send({ type: `follow:${type}`, projectId: 'default', ...extra });
  assert.deepEqual((await send('list')).requirements, { basedIn: '', connectedVia: '' });
  await send('requirements', { requirements: { basedIn: ' United States ', connectedVia: 'United States App Store' } });
  assert.equal((await send('list')).requirements.basedIn, 'United States');
  assert.equal((await app.send({ type: 'follow:list', projectId: 'other' })).requirements.basedIn, '');
  const restarted = setup(); Object.assign(restarted.stored, structuredClone(app.stored));
  assert.equal((await restarted.send({ type: 'follow:list', projectId: 'default' })).requirements.connectedVia, 'United States App Store');
  assert.match((await send('requirements', { requirements: { basedIn: 'x'.repeat(101) } })).error, /100 characters/);
  assert.equal((await send('list')).requirements.basedIn, 'United States');
});

test('handle capture deduplicates scrolled lists, persists per project, and rejects wrong tabs and stale sessions', async () => {
  const app = setup();
  const { config } = await app.send({ type: 'getState' });
  config.projects.other = { name: 'Other', rules: [], options: {} };
  await app.send({ type: 'saveConfig', config });
  const send = (action, extra = {}) => app.send({ type: `handles:${action}`, projectId: 'default', ...extra });
  const started = await send('start', { url: 'https://x.com/owner/followers' });
  assert.equal(started.session.active, true);
  const sender = { tab: { id: 6 }, frameId: 0, url: 'https://x.com/owner/followers' };
  const capture = { type: 'handles:capture', sessionId: started.session.id, entries: ['Alice', 'alice', 'bob'] };
  assert.equal((await app.send(capture, sender)).active, true);
  await app.send(capture, sender);
  assert.deepEqual((await send('status')).entries.map(entry => entry.handle), ['alice', 'bob']);
  assert.equal((await app.send({ type: 'handles:status', projectId: 'other' })).entries.length, 0);
  assert.equal((await app.send({ type: 'handles:status' }, sender)).entries, undefined);
  assert.equal((await app.send(capture, { ...sender, tab: { id: 8 } })).active, false);
  assert.equal((await app.send(capture, { ...sender, url: 'https://x.com/owner/following' })).active, false);
  assert.match((await app.send(capture, { ...sender, frameId: 2 })).error, /lists only/);
  assert.match((await app.send({ ...capture, entries: Array(101).fill('alice') }, sender)).error, /batch/);
  assert.match((await app.send({ ...capture, entries: ['insta:alice'] }, sender)).error, /X handles/);
  assert.match((await app.send({ type: 'handles:clear', projectId: 'default' }, sender)).error, /extension/);
  const restarted = setup(); Object.assign(restarted.stored, structuredClone(app.stored));
  assert.equal((await restarted.send({ type: 'handles:status', projectId: 'default' })).entries.length, 2);
  await send('stop');
  assert.equal((await app.send(capture, sender)).active, false);
  assert.equal((await send('status')).entries.length, 2);
  const next = await send('start', { url: 'https://x.com/owner/following' });
  assert.notEqual(next.session.id, started.session.id);
  assert.equal((await app.send(capture, sender)).active, false);
  await send('clear');
  assert.equal((await send('status')).entries.length, 0);
  assert.equal((await send('status')).session.active, false);
  assert.match((await send('start', { url: 'https://evil.example/owner/followers' })).error, /list URL/);
});

test('handle capture stops visibly at the project limit without dropping earlier handles', async () => {
  const app = setup();
  app.stored.capturedHandles = { default: Array.from({ length: 999 }, (_, i) => ({ key: `x:user${i}`, handle: `user${i}` })) };
  const start = await app.send({ type: 'handles:start', projectId: 'default', url: 'https://x.com/owner/following' });
  const result = await app.send({ type: 'handles:capture', sessionId: start.session.id, entries: ['last', 'overflow'] },
    { tab: { id: 6 }, frameId: 0, url: 'https://x.com/owner/following' });
  assert.equal(result.active, false);
  const status = await app.send({ type: 'handles:status', projectId: 'default' });
  assert.equal(status.entries.length, 1000);
  assert.equal(status.entries.at(-1).handle, 'last');
  assert.match(status.session.error, /1,000/);
});

test('follow speed defaults to normal, persists by project, and rejects invalid settings', async () => {
  const app = setup();
  const { config } = await app.send({ type: 'getState' });
  config.projects.other = { name: 'Other', rules: [], options: {} };
  await app.send({ type: 'saveConfig', config });
  const send = (type, extra = {}) => app.send({ type: `follow:${type}`, projectId: 'default', ...extra });
  assert.equal((await send('list')).speed, 'normal');
  assert.equal((await send('speed', { speed: 'fast' })).speed, 'fast');
  assert.equal((await app.send({ type: 'follow:list', projectId: 'other' })).speed, 'normal');
  const restarted = setup(); Object.assign(restarted.stored, structuredClone(app.stored));
  assert.equal((await restarted.send({ type: 'follow:list', projectId: 'default' })).speed, 'fast');
  assert.match((await send('speed', { speed: 'instant' })).error, /Choose Slow/);
  assert.equal((await send('list')).speed, 'fast');
  assert.match((await send('speed', { speed: 'slow', projectId: 'missing' })).error, /existing project/);
});

test('nearby auto-like defaults off and persists independently of highlighting', async () => {
  const app = setup(); const { config } = await app.send({ type: 'getState' });
  assert.equal(config.autoLikeX, false);
  config.autoLikeX = true; config.autoHighlight = false;
  assert.equal((await app.send({ type: 'saveConfig', config })).ok, true);
  assert.equal((await app.send({ type: 'getState' })).config.autoLikeX, true);
  assert.equal(app.stored.config.autoHighlight, false);
  config.autoLikeX = false;
  assert.equal((await app.send({ type: 'saveConfig', config })).ok, true);
  assert.equal((await app.send({ type: 'getState' })).config.autoLikeX, false);
});
