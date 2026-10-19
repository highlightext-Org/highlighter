// Firefox preloads these scripts in its event page; Chrome uses a service worker.
if (typeof importScripts === 'function') importScripts('ai.js', 'definitions.js', 'matcher.js', 'timeline.js', 'follows.js', 'chrome-host.js');
const SOURCE = 'https://highlightext-org.github.io/words/master.json';
// Bump when parsing changes so previously normalized caches are downloaded again.
const DEFINITIONS_VERSION = 3;
let pending, writeQueue = Promise.resolve();
const defaultConfig = () => ({ activeProject: 'default', autoHighlight: true, autoLikeX: false, autoFollowX: false, autoRefresh: false, localRules: [], projects: { default: { name: 'Default', rules: [], overrides: {}, disabledGroups: [], options: { wholeWords: true, caseSensitive: false }, recordMatches: false } } });
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
  if (message.type?.startsWith('handles:')) return handleCapture(message, sender);
  if (message.type?.startsWith('follow:')) return handleFollows(message);
  if (message.type?.startsWith('timeline:')) return handleTimeline(message, sender);
  switch (message.type) {
    case 'loadTerms': {
      try { await loadTerms(message.force); return { ok: true, ...await state() }; }
      catch (error) { return { ok: false, error: error.message, ...await state() }; }
    }
    case 'getState': return state();
    case 'hext:settings': {
      const config = await getConfig();
      const enabled = config.autoHighlight !== false;
      if (enabled) await loadTerms().catch(() => {}); // Keep using cached/local rules offline.
      return { enabled, projectId: config.activeProject };
    }
    case 'saveConfig': return mutate(async () => {
      const previous = await getConfig();
      const config = validateConfig(message.config), cached = await cachedDefinitions();
      for (const project of Object.values(config.projects)) {
        const rules = HighlightextRules.resolveRules(cached.remoteRules, config.localRules, project);
        if (rules.filter(rule => rule.type === 'regex').length > Highlightext.MAX_REGEX_RULES) throw new Error(`Enable at most ${Highlightext.MAX_REGEX_RULES} regex rules per project.`);
      }
      await chrome.storage.local.set({ config }); await configureAlarms(config);
      if (config.autoHighlight !== false && previous.autoHighlight === false) await attachHighlights();
      if (config.autoLikeX === true && previous.autoLikeX !== true) await attachAutoLike();
      if (config.autoFollowX === true && previous.autoFollowX !== true) await attachAutoFollow();
      return { ok: true };
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
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) && !['scan', 'hext:settings', 'timeline:capture', 'timeline:status', 'handles:capture', 'handles:status'].includes(message.type)) { respond({ error: 'Open the extension to manage rules.' }); return; }
  if (message.type?.startsWith('ai:')) {
    // Only our UI can manage credentials or incur paid API calls.
    if (![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html')].some(url => sender.url?.split('?')[0] === url)) {
      respond({ error: 'Open the extension to use AI correction.' }); return;
    }
    HighlightextAI.handle(message).then(respond, error => respond({ error: error.message }));
    return true;
  }
  handle(message, sender).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === 'definitions-sync') loadTerms(true).catch(() => {}); });
async function attachAutoLike() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['auto-like-content.js'] })));
}
async function attachAutoFollow() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['auto-follow-content.js'] })));
}
async function attachHighlights() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })));
}
let restoringFeatures;
function restoreEnabledFeatures() {
  // Backgrounds also restart on reload/enable and service-worker wake, without
  // an install event. Reattach to existing tabs using the saved choices.
  if (restoringFeatures) return restoringFeatures;
  restoringFeatures = (async () => {
    const config = await getConfig();
    await Promise.allSettled([
      configureAlarms(config),
      ...(config.autoHighlight !== false ? [attachHighlights()] : []),
      ...(config.autoLikeX === true ? [attachAutoLike()] : []),
      ...(config.autoFollowX === true ? [attachAutoFollow()] : [])
    ]);
  })().finally(() => { restoringFeatures = null; });
  return restoringFeatures;
}
const restoreFeatures = () => restoreEnabledFeatures().catch(() => {});
chrome.runtime.onInstalled?.addListener(restoreFeatures);
chrome.runtime.onStartup?.addListener(restoreFeatures);
chrome.permissions?.onAdded?.addListener(restoreFeatures);
restoreFeatures();


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

// Queue mutations share the existing serialized local-storage writer.
async function handleFollows(message) {
  return mutate(async () => {
    const config = await getConfig();
    if (!Object.hasOwn(config.projects, message.projectId)) throw new Error('Select an existing project.');
    const { followQueues = {} } = await chrome.storage.local.get('followQueues');
    let entries = Object.hasOwn(followQueues, message.projectId) ? followQueues[message.projectId] : [];
    const { followRequirements = {} } = await chrome.storage.local.get('followRequirements');
    const requirements = Object.hasOwn(followRequirements, message.projectId) ? followRequirements[message.projectId] : HighlightextFollows.requirements();
    const { followSpeeds = {} } = await chrome.storage.local.get('followSpeeds');
    const speed = Object.hasOwn(followSpeeds, message.projectId) ? followSpeeds[message.projectId] : 'normal';
    switch (message.type) {
      case 'follow:list': return { entries, requirements, speed };
      case 'follow:speed': {
        const next = HighlightextFollows.speed(message.speed);
        Object.defineProperty(followSpeeds, message.projectId, { value: next, enumerable: true, configurable: true, writable: true });
        await chrome.storage.local.set({ followSpeeds });
        return { entries, speed: next };
      }
      case 'follow:requirements': {
        const next = HighlightextFollows.requirements(message.requirements);
        Object.defineProperty(followRequirements, message.projectId, { value: next, enumerable: true, configurable: true, writable: true });
        await chrome.storage.local.set({ followRequirements });
        return { entries, requirements: next };
      }
      case 'follow:add': {
        const parsed = HighlightextFollows.parse(message.text, message.platform);
        const existing = new Set(entries.map(entry => entry.key));
        const added = parsed.entries.filter(entry => !existing.has(entry.key));
        if (entries.length + added.length > 1000) throw new Error('At most 1,000 queued accounts per project.');
        if (Object.values(followQueues).reduce((n, queue) => n + queue.length, 0) + added.length > 5000) throw new Error('At most 5,000 queued accounts across projects.');
        entries = entries.concat(added.map(entry => ({ ...entry, status: 'pending', detail: '' })));
        Object.defineProperty(followQueues, message.projectId, { value: entries, enumerable: true, configurable: true, writable: true });
        await chrome.storage.local.set({ followQueues });
        return { entries, added: added.length, duplicates: parsed.duplicates + parsed.entries.length - added.length, errors: parsed.errors };
      }
      case 'follow:update': {
        const allowed = ['pending', 'processing', 'followed', 'already-following', 'requested', 'reviewed', 'skipped', 'blocked'];
        if (!allowed.includes(message.status)) throw new Error('Invalid queue status.');
        const entry = entries.find(entry => entry.key === message.key);
        if (!entry) throw new Error('Queue entry no longer exists.');
        entry.status = message.status; entry.detail = String(message.detail || '').slice(0, 300);
        break;
      }
      // Keep interrupted and blocked actions available for review when clearing completed items.
      case 'follow:clear': entries = entries.filter(entry => ['pending', 'processing', 'blocked'].includes(entry.status)); break;
      default: throw new Error('Unknown follow request.');
    }
    Object.defineProperty(followQueues, message.projectId, { value: entries, enumerable: true, configurable: true, writable: true });
    await chrome.storage.local.set({ followQueues });
    return { entries };
  });
}

async function handleCapture(message, sender) {
  const F = HighlightextFollows;
  const fromPage = sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''));
  if (fromPage && (sender.frameId > 0 || !F.listSource(sender.url))) throw new Error('Handle capture supports X followers and following lists only.');
  if (message.type === 'handles:status' && fromPage) {
    const { handleCaptureSession = null } = await chrome.storage.local.get('handleCaptureSession');
    return { session: handleCaptureSession?.tabId === sender.tab.id ? handleCaptureSession : null };
  }
  return mutate(async () => {
    const { handleCaptureSession: session = null, capturedHandles = {} } = await chrome.storage.local.get(['handleCaptureSession', 'capturedHandles']);
    if (message.type === 'handles:capture') {
      if (!fromPage) throw new Error('Capture must come from a list page.');
      if (!session?.active || session.id !== message.sessionId || session.tabId !== sender.tab.id || F.listSource(sender.url).url !== session.sourceUrl) return { active: false };
      if (!Array.isArray(message.entries) || message.entries.length > 100 || message.entries.some(value => typeof value !== 'string' || value.length > 16)) throw new Error('Handle capture batch is too large or invalid.');
      const config = await getConfig();
      if (!Object.hasOwn(config.projects, session.projectId)) return { active: false };
      const entries = Object.hasOwn(capturedHandles, session.projectId) ? capturedHandles[session.projectId] : [];
      const keys = new Set(entries.map(entry => entry.key));
      for (const value of message.entries) {
        const entry = F.profile(value, 'x');
        if (entry.platform !== 'x') throw new Error('Capture accepts X handles only.');
        if (!keys.has(entry.key) && entries.length < 1000) {
          keys.add(entry.key); entries.push({ ...entry, sourceUrl: session.sourceUrl, capturedAt: new Date().toISOString() });
        }
      }
      Object.defineProperty(capturedHandles, session.projectId, { value: entries, enumerable: true, writable: true, configurable: true });
      const next = entries.length >= 1000 ? { ...session, active: false, error: 'Reached the 1,000 handle limit for this project. Download or clear captured handles to continue.' } : session;
      try { await chrome.storage.local.set({ capturedHandles, handleCaptureSession: next }); }
      catch (error) {
        await chrome.storage.local.set({ handleCaptureSession: { ...session, active: false, error: `Capture stopped: ${error.message}` } });
        throw error;
      }
      return { active: next.active };
    }
    if (fromPage) throw new Error('Open the extension to manage handle capture.');
    const config = await getConfig();
    if (!Object.hasOwn(config.projects, message.projectId)) throw new Error('Select an existing project.');
    const entries = Object.hasOwn(capturedHandles, message.projectId) ? capturedHandles[message.projectId] : [];
    switch (message.type) {
      case 'handles:status': return { entries, session };
      case 'handles:start': {
        const source = F.listSource(message.url);
        if (!source) throw new Error('Use an X followers or following list URL.');
        if (entries.length >= 1000) throw new Error('Download or clear the 1,000 captured handles before continuing.');
        const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
        const existing = tabs.find(tab => F.listSource(tab.url)?.url === source.url);
        const tab = existing ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: source.url, active: true });
        const next = { id: crypto.randomUUID(), active: true, projectId: message.projectId, tabId: tab.id, sourceUrl: source.url };
        await chrome.storage.local.set({ handleCaptureSession: next });
        // New/loading tabs receive the manifest content script when their document loads.
        try { if (existing?.status === 'complete') await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['follows.js', 'handle-capture-content.js'] }); }
        catch (error) {
          await chrome.storage.local.set({ handleCaptureSession: { ...next, active: false, error: `Could not attach capture: ${error.message}. Allow website access and try again.` } });
          throw error;
        }
        return { entries, session: next };
      }
      case 'handles:stop':
      case 'handles:clear': {
        const changes = {};
        if (session?.projectId === message.projectId) changes.handleCaptureSession = { ...session, active: false };
        if (message.type === 'handles:clear') {
          delete capturedHandles[message.projectId]; changes.capturedHandles = capturedHandles;
        }
        await chrome.storage.local.set(changes);
        return { entries: message.type === 'handles:clear' ? [] : entries, session: changes.handleCaptureSession || session };
      }
      default: throw new Error('Unknown handle capture request.');
    }
  });
}
