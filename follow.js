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
  $('requirements').disabled = busy || running;
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
function readRequirements() {
  return HighlightextFollows.requirements({ basedIn: $('based-in').value, connectedVia: $('connected-via').value });
}
async function saveRequirements() {
  const requirements = readRequirements();
  await request('requirements', { requirements });
  $('requirements-status').textContent = 'Requirements saved for this project.';
  return requirements;
}
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
    // Snapshot and persist the visible requirements before processing any account.
    const requirements = await saveRequirements();
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
      let check;
      if (requirements.basedIn || requirements.connectedVia) {
        const [response] = await chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: checkXRequirements, args: [canonical.handle, requirements] });
        check = response?.result;
        if (!check || !['matched', 'skipped', 'blocked'].includes(check.status)) throw new Error('Could not read location check result.');
        if (check.status === 'blocked') throw new Error(check.detail);
        const checkedTab = await chrome.tabs.get(profileTabId);
        const aboutURL = new URL(checkedTab.url);
        if (!['x.com', 'twitter.com'].includes(aboutURL.hostname) || aboutURL.pathname.replace(/\/$/, '').toLowerCase() !== `/${canonical.handle}/about`) throw new Error('Profile changed after the location check.');
        profileURL = checkedTab.url;
        if (check.status === 'skipped') {
          await request('update', { key: current.key, ...check });
          current = null;
          // Keep the account details visible before moving to the next profile.
          for (let n = 0; n < 30 && !stopRequested; n++) await delay(1000);
          continue;
        }
        if (stopRequested) throw new Error('Stopped before following.');
        // Only return from the About page we opened; do not overwrite user navigation.
        await chrome.tabs.update(profileTabId, { url: canonical.url, active: true });
        profileURL = canonical.url;
        await waitForProfile(profileTabId);
        if (stopRequested) throw new Error('Stopped before following.');
      }
      const [response] = await chrome.scripting.executeScript({ target: { tabId: profileTabId }, func: followXProfile, args: [canonical.handle] });
      const result = response?.result;
      if (!result || !['followed', 'already-following', 'requested', 'blocked'].includes(result.status)) throw new Error('Could not read follow result.');
      if (check) result.detail = `${result.detail} ${check.detail}`;
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
for (const id of ['based-in', 'connected-via']) $(id).addEventListener('change', () => perform(saveRequirements));
$('us-preset').addEventListener('click', () => perform(async () => {
  $('based-in').value = 'United States';
  $('connected-via').value = 'United States App Store';
  await saveRequirements();
}));
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
    const result = await request('list');
    $('based-in').value = result.requirements?.basedIn || '';
    $('connected-via').value = result.requirements?.connectedVia || '';
  } catch (error) { $('error').textContent = error.message; }
})();
