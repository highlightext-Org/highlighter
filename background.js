// Firefox preloads these scripts in its event page; Chrome uses a service worker.
if (typeof importScripts === 'function') importScripts('definitions.js', 'matcher.js', 'timeline.js', 'chrome-host.js');
const SOURCE = 'https://highlightext-org.github.io/words/master.json';
// Bump when parsing changes so previously normalized caches are downloaded again.
const DEFINITIONS_VERSION = 2;
let pending, writeQueue = Promise.resolve();
const defaultConfig = () => ({ activeProject: 'default', autoRefresh: false, localRules: [], projects: { default: { name: 'Default', rules: [], overrides: {}, disabledGroups: [], options: { wholeWords: true, caseSensitive: false }, recordMatches: false } } });
async function getConfig() {
  const { config, options } = await chrome.storage.local.get(['config', 'options']);
  if (config) return config;
  const initial = defaultConfig();
  if (options) initial.projects.default.options = options;
  return initial;
}
function mutate(task) {
  const next = writeQueue.then(task);
  writeQueue = next.catch(() => {}); return next;
}
async function cachedDefinitions() {
  const cached = await chrome.storage.local.get(['remoteRules', 'terms', 'updatedAt', 'syncError', 'definitionErrors', 'definitionsVersion']);
  return { ...cached, remoteRules: cached.remoteRules || (cached.terms || []).map(rule => HighlightextRules.normalizeRule(rule)) };
}
async function loadTerms(force = false) {
  const cached = await cachedDefinitions(), config = await getConfig();
  if (!force && cached.definitionsVersion === DEFINITIONS_VERSION && cached.remoteRules.length && (!config.autoRefresh || Date.now() - cached.updatedAt < 86400000)) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(SOURCE, { cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Definitions download failed (HTTP ${response.status}).`);
      const { rules, errors } = HighlightextRules.extractRules(await HighlightextRules.readDefinitions(response));
      if (!rules.length) throw new Error('The source contains no valid rules.');
      const result = { remoteRules: rules, updatedAt: Date.now(), syncError: '', definitionErrors: errors, definitionsVersion: DEFINITIONS_VERSION };
      await chrome.storage.local.set(result);
      return result;
    } catch (error) {
      await chrome.storage.local.set({ syncError: error.message });
      throw error;
    }
  })();
  try { return await pending; } finally { pending = null; }
}
async function state() {
  const [cached, config, { records = [] }] = await Promise.all([cachedDefinitions(), getConfig(), chrome.storage.local.get('records')]);
  const project = config.projects[config.activeProject];
  return { ...cached, config, recordCount: records.length, terms: HighlightextRules.resolveRules(cached.remoteRules, config.localRules, project) };
}
async function configureAlarms(config) {
  if (!chrome.alarms) return;
  if (config.autoRefresh) await chrome.alarms.create('definitions-sync', { periodInMinutes: 1440 });
  else await chrome.alarms.clear('definitions-sync');
}
function validateConfig(config) {
  if (!config || !config.projects || !Object.hasOwn(config.projects, config.activeProject)) throw new Error('Select a valid project.');
  if (Object.keys(config.projects).length > 50) throw new Error('At most 50 projects are supported.');
  const normalize = rules => { if (!Array.isArray(rules) || rules.length > 20000) throw new Error('At most 20,000 custom rules per scope.'); return rules.map(rule => HighlightextRules.normalizeRule(rule)); };
  config.localRules = normalize(config.localRules || []);
  for (const project of Object.values(config.projects)) {
    project.name = String(project.name || 'Project').slice(0, 100);
    project.rules = normalize(project.rules || []);
    project.overrides ||= {}; project.disabledGroups ||= []; project.options ||= {};
  }
  return config;
}
async function scan(message, sender) {
  if (!Array.isArray(message.texts) || message.texts.length > 2000 || message.texts.some(text => typeof text !== 'string') || message.texts.reduce((n, s) => n + s.length, 0) > 200000) throw new Error('Scan exceeds the 200,000 character / 2,000 block limit.');
  const config = await getConfig(), cached = await cachedDefinitions();
  const projectId = message.projectId || config.activeProject, project = config.projects[projectId];
  if (!project) throw new Error('This project no longer exists. Reopen the popup.');
  const rules = HighlightextRules.resolveRules(cached.remoteRules, config.localRules, project);
  const result = await runMatchJob({ rules, options: project.options, texts: message.texts });
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) && project.recordMatches && result.results) await mutate(async () => {
    const { records = [] } = await chrome.storage.local.get('records');
    const url = sender.url || sender.tab.url || '';
    const host = new URL(url).hostname;
    const platform = /(^|\.)(x\.com|twitter\.com)$/.test(host) ? 'X' : /(^|\.)facebook\.com$/.test(host) ? 'Facebook' : /(^|\.)instagram\.com$/.test(host) ? 'Instagram' : /(^|\.)reddit\.com$/.test(host) ? 'Reddit' : host;
    const keys = new Set(records.map(record => record.key));
    result.results.forEach((matches, block) => matches.forEach(item => {
      const matchedText = message.texts[block].slice(item.start, item.end);
      const key = JSON.stringify([projectId, url, item.term.id, matchedText, block, item.start]);
      if (!keys.has(key)) {
        keys.add(key); records.push({ key, matchedText, ruleId: item.term.id, category: item.term.category, platform, sourceUrl: url, timestamp: new Date().toISOString(), projectId });
      }
    }));
    let bytes = 0; const retained = [];
    for (const record of records.slice(-2000).reverse()) {
      bytes += JSON.stringify(record).length * 2;
      if (bytes > 2 * 1024 * 1024) break;
      retained.push(record);
    }
    await chrome.storage.local.set({ records: retained.reverse() });
  });
  // Return compact rule metadata rather than repeating all configuration per match.
  return result;
}
async function handle(message, sender) {
  if (message.type?.startsWith('timeline:')) return handleTimeline(message, sender);
  switch (message.type) {
    case 'loadTerms': {
      try { await loadTerms(message.force); return { ok: true, ...await state() }; }
      catch (error) { return { ok: false, error: error.message, ...await state() }; }
    }
    case 'getState': return state();
    case 'saveConfig': return mutate(async () => {
      const config = validateConfig(message.config), cached = await cachedDefinitions();
      for (const project of Object.values(config.projects)) {
        const rules = HighlightextRules.resolveRules(cached.remoteRules, config.localRules, project);
        if (rules.filter(rule => rule.type === 'regex').length > Highlightext.MAX_REGEX_RULES) throw new Error(`Enable at most ${Highlightext.MAX_REGEX_RULES} regex rules per project.`);
      }
      await chrome.storage.local.set({ config }); await configureAlarms(config); return { ok: true };
    });
    case 'scan': return scan(message, sender);
    case 'getRecords': { const { records = [] } = await chrome.storage.local.get('records'); return { records: records.filter(record => record.projectId === message.projectId) }; }
    case 'clearRecords': return mutate(async () => { const { records = [] } = await chrome.storage.local.get('records'); await chrome.storage.local.set({ records: records.filter(record => record.projectId !== message.projectId) }); return { ok: true }; });
    default: throw new Error('Unknown request.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === 'match-host') return;
  // Injected scripts can scan a page; configuration and exports belong to extension UI.
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) && !['scan', 'timeline:capture', 'timeline:status'].includes(message.type)) { respond({ error: 'Open the extension to manage rules.' }); return; }
  handle(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === 'definitions-sync') loadTerms(true).catch(() => {}); });
chrome.runtime.onStartup?.addListener(() => getConfig().then(configureAlarms));
chrome.runtime.onInstalled?.addListener(() => getConfig().then(configureAlarms));

async function timelineState(projectId) {
  const { timelineSession = null, timelineRecords = [], timelineDropped = 0 } = await chrome.storage.local.get(['timelineSession', 'timelineRecords', 'timelineDropped']);
  return { session: timelineSession, count: timelineRecords.filter(record => record.projectId === projectId).length,
    total: timelineRecords.length, dropped: timelineDropped };
}
async function handleTimeline(message, sender) {
  const T = HighlightextTimeline;
  const fromPage = sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''));
  if (fromPage && !T.platform(sender.url)) throw new Error('Timeline recording supports X, Instagram, and TikTok.');
  if (message.type === 'timeline:status') {
    // Pages only need the session token, never saved text from other tabs.
    if (fromPage) { const { timelineSession = null } = await chrome.storage.local.get('timelineSession'); return { session: timelineSession }; }
    return timelineState(message.projectId);
  }
  if (message.type === 'timeline:capture') {
    if (!fromPage || sender.frameId > 0) throw new Error('Timeline posts must come from a supported page.');
    if (!Array.isArray(message.entries) || message.entries.length > 100 || JSON.stringify(message.entries).length > 1500000) throw new Error('Timeline batch is too large.');
    return mutate(async () => {
      const { timelineSession, timelineRecords = [], timelineDropped = 0 } = await chrome.storage.local.get(['timelineSession', 'timelineRecords', 'timelineDropped']);
      // Check inside the write queue: stop and clear cannot race with pending captures.
      if (!timelineSession?.active || timelineSession.id !== message.sessionId) return { active: false };
      const now = new Date().toISOString();
      const entries = message.entries.map(entry => T.normalize(entry, sender.url, timelineSession.projectId, now));
      const result = T.append(timelineRecords, entries);
      try {
        await chrome.storage.local.set({ timelineRecords: result.records, timelineDropped: timelineDropped + result.dropped });
      } catch (error) {
        await chrome.storage.local.set({ timelineSession: { ...timelineSession, active: false, error: `Recording stopped: ${error.message}` } });
        throw error;
      }
      return { active: true };
    });
  }
  if (fromPage) throw new Error('Open the extension to manage timeline recording.');
  switch (message.type) {
    case 'timeline:start': {
      await mutate(async () => {
        const config = await getConfig();
        if (!config.projects[message.projectId]) throw new Error('Select a valid project.');
        await chrome.storage.local.set({ timelineSession: { id: crypto.randomUUID(), active: true, projectId: message.projectId, startedAt: new Date().toISOString() } });
      });
      // Manifest scripts cover future navigations; attach to supported tabs already open.
      const tabs = await chrome.tabs.query({ url: T.MATCHES });
      const attached = await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['timeline.js', 'timeline-content.js'] })));
      return { ...await timelineState(message.projectId), attachErrors: attached.filter(result => result.status === 'rejected').length };
    }
    case 'timeline:stop':
      return mutate(async () => {
        const { timelineSession } = await chrome.storage.local.get('timelineSession');
        if (timelineSession) await chrome.storage.local.set({ timelineSession: { ...timelineSession, active: false, stoppedAt: new Date().toISOString() } });
        return timelineState(message.projectId);
      });
    case 'timeline:clear':
      return mutate(async () => {
        const { timelineRecords = [], timelineSession } = await chrome.storage.local.get(['timelineRecords', 'timelineSession']);
        const changes = { timelineRecords: timelineRecords.filter(record => record.projectId !== message.projectId) };
        // Stop this project's session so visible posts do not immediately reappear.
        if (timelineSession?.projectId === message.projectId) changes.timelineSession = { ...timelineSession, id: crypto.randomUUID(), active: false, stoppedAt: new Date().toISOString() };
        if (!changes.timelineRecords.length) changes.timelineDropped = 0;
        await chrome.storage.local.set(changes);
        return timelineState(message.projectId);
      });
    case 'timeline:export': {
      const { timelineRecords = [] } = await chrome.storage.local.get('timelineRecords');
      return { records: timelineRecords.filter(record => record.projectId === message.projectId).map(({ key, ...record }) => record) };
    }
    default: throw new Error('Unknown timeline request.');
  }
}
