'use strict';
const $ = id => document.getElementById(id);
const projectId = new URLSearchParams(location.search).get('project') || 'default';
let entries = [], running = false, stopRequested = false, profileTabId, profileURL, busy = false;
const terminal = new Set(['followed', 'already-following', 'requested', 'reviewed', 'skipped']);
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type: `follow:${type}`, projectId, ...extra });
  if (result.error) throw new Error(result.error);
  entries = result.entries; draw(); return result;
}
function draw() {
  $('status').textContent = `${entries.length} accounts · ${entries.filter(entry => terminal.has(entry.status)).length} completed / skipped${running ? ' · X queue running' : ''}`;
  $('start').disabled = busy || running || !entries.some(entry => entry.platform === 'x' && entry.status === 'pending');
  $('stop').disabled = !running || stopRequested;
  $('clear').disabled = busy || running || !entries.some(entry => terminal.has(entry.status));
  $('import').disabled = busy || running;
  $('queue').replaceChildren(...entries.map(entry => {
    const row = document.createElement('li'), link = document.createElement('a'), status = document.createElement('span');
    link.textContent = `${HighlightextFollows.PLATFORMS[entry.platform].name} · @${entry.handle}`;
    link.href = entry.url; link.target = '_blank'; link.rel = 'noopener';
    status.textContent = `${entry.status}${entry.detail ? ` · ${entry.detail}` : ''}`;
    row.append(link, status);
    const action = (label, next) => {
      const button = document.createElement('button'); button.textContent = label; button.disabled = running || busy;
      button.addEventListener('click', () => perform(() => request('update', { key: entry.key, status: next })));
      row.append(button);
    };
    if (!terminal.has(entry.status)) { action('Mark reviewed', 'reviewed'); action('Skip', 'skipped'); }
    if (entry.status === 'blocked' || entry.status === 'processing' || terminal.has(entry.status)) action('Requeue', 'pending');
    return row;
  }));
}
async function perform(task) {
  if (busy) return;
  busy = true; $('error').textContent = ''; draw();
  try { await task(); } catch (error) { $('error').textContent = error.message; }
  finally { busy = false; draw(); }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForProfile(id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopRequested) throw new Error('Stopped before following.');
    const tab = await chrome.tabs.get(id);
    if (tab.status === 'complete') { await delay(1500); return; }
    await delay(500);
  }
  throw new Error('Profile load timed out.');
}
async function runQueue() {
  running = true; stopRequested = false; $('error').textContent = ''; draw();
  let current;
  try {
    while (!stopRequested) {
      await request('list');
      current = entries.find(entry => entry.platform === 'x' && entry.status === 'pending');
      if (!current) break;
      // Persist before the external action: interrupted items require review, never an automatic retry.
      await request('update', { key: current.key, status: 'processing', detail: 'If interrupted, check this profile before requeueing.' });
      const canonical = HighlightextFollows.profile(current.handle, 'x');
      let previous;
      if (profileTabId) {
        try { previous = await chrome.tabs.get(profileTabId); } catch { /* Closed by the user. */ }
      }
      // Reuse our own profile tab only if the user has not navigated it elsewhere.
      const tab = previous && previous.url === profileURL
        ? await chrome.tabs.update(profileTabId, { url: canonical.url, active: true })
        : await chrome.tabs.create({ url: canonical.url, active: true });
      profileTabId = tab.id; profileURL = canonical.url;
      await waitForProfile(profileTabId);
      if (stopRequested) throw new Error('Stopped before following.');
      const [response] = await chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: followXProfile, args: [canonical.handle] });
      const result = response?.result;
      if (!result || !['followed', 'already-following', 'requested', 'blocked'].includes(result.status)) throw new Error('Could not read follow result.');
      await request('update', { key: current.key, ...result });
      current = null;
      if (result.status === 'blocked') throw new Error(result.detail);
      // Keep the current profile visible during the pause.
      for (let n = 0; n < 30 && !stopRequested; n++) await delay(1000);
    }
  } catch (error) {
    $('error').textContent = error.message;
    if (current) {
      try { await request('update', { key: current.key, status: 'blocked', detail: error.message }); }
      catch { /* The persisted processing state still prevents automatic retries. */ }
    }
  } finally { running = false; draw(); }
}
$('import').addEventListener('click', () => perform(async () => {
  const result = await request('add', { text: $('handles').value, platform: $('platform').value });
  $('import-status').textContent = `${result.added} added · ${result.duplicates} duplicates · ${result.errors.length} invalid${result.errors.length ? ': ' + result.errors.slice(0, 5).map(item => `${item.value}: ${item.error}`).join('; ') : ''}`;
  if (!result.errors.length) $('handles').value = '';
}));
$('clear').addEventListener('click', () => perform(() => request('clear')));
$('start').addEventListener('click', () => {
  // Browser-wide lock prevents two manager tabs from running the same queue.
  navigator.locks.request('highlightext-follow-run', { ifAvailable: true }, async lock => {
    if (!lock) { $('error').textContent = 'A follow queue is running in another manager tab.'; return; }
    await runQueue();
  }).catch(error => { $('error').textContent = error.message; });
});
$('stop').addEventListener('click', () => { stopRequested = true; draw(); $('status').textContent = 'Stopping after any in-flight follow finishes…'; });
(async () => {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'getState' });
    if (!state.config?.projects[projectId]) throw new Error('This project no longer exists. Reopen from the extension.');
    $('project-name').textContent = state.config.projects[projectId].name;
    await request('list');
  } catch (error) { $('error').textContent = error.message; }
})();
