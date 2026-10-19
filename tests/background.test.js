const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Rules = require('../definitions');
const Matcher = require('../matcher');
function setup(data = { rules: [{ id: 'risk', text: 'risk', category: 'QA' }] }) {
  const stored = {}, alarms = new Map(); let listener, fail = false, downloads = 0;
  const context = vm.createContext({
    AbortSignal, HighlightextRules: Rules, Highlightext: Matcher, URL,
    fetch: async () => { downloads++; if (fail) throw new Error('Offline test'); return { ok: true, json: async () => data }; },
    runMatchJob: async job => ({ results: job.texts.map(text => Matcher.createMatcher(job.rules, job.options)(text)), capped: false }),
    chrome: {
      runtime: { getURL: file => `moz-extension://test/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
      alarms: { onAlarm: { addListener() {} }, create: async (id, options) => alarms.set(id, options), clear: async id => alarms.delete(id) },
      storage: { local: {
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in stored).map(key => [key, structuredClone(stored[key])])),
        set: async values => Object.assign(stored, structuredClone(values))
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../background'), 'utf8'), context);
  return { stored, alarms, downloads: () => downloads, offline: () => { fail = true; }, send: (message, sender = {}) => new Promise(resolve => listener(message, sender, resolve)) };
}

test('sync cache preserves last success and visible errors across offline requests', async () => {
  const app = setup();
  const first = await app.send({ type: 'loadTerms' }); assert.equal(first.terms.length, 1);
  app.offline(); const offline = await app.send({ type: 'loadTerms', force: true });
  assert.equal(offline.ok, false); assert.equal(offline.terms[0].id, 'risk'); assert.equal(offline.updatedAt, first.updatedAt);
  const cached = await app.send({ type: 'loadTerms' }); assert.equal(cached.syncError, 'Offline test'); assert.equal(app.downloads(), 2);
});

test('old cached literals refresh once and a 226-pattern master can save and scan', async () => {
  const keywords = Array.from({ length: 226 }, (_, i) => ({ text: `\\bplace[\\s-]*${i}\\b`, match_mode: 'regex' }));
  const app = setup({ schema_version: 1, keywords, profiles: [] });
  app.stored.remoteRules = [Rules.normalizeRule({ text: keywords[0].text })];
  app.stored.updatedAt = Date.now();
  const loaded = await app.send({ type: 'loadTerms' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.terms.length, 226);
  assert(loaded.terms.every(rule => rule.type === 'regex'));
  assert.equal((await app.send({ type: 'saveConfig', config: loaded.config })).ok, true);
  const scan = await app.send({ type: 'scan', texts: ['PLACE-225 place 0'] });
  assert.equal(scan.results[0].length, 2);
  await app.send({ type: 'loadTerms' });
  assert.equal(app.downloads(), 1);
  loaded.config.projects.default.rules = Array.from({ length: Matcher.MAX_REGEX_RULES + 1 }, (_, i) =>
    ({ id: `local-${i}`, text: `custom${i}`, type: 'regex' }));
  assert.match((await app.send({ type: 'saveConfig', config: loaded.config })).error, /at most 500/);
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
