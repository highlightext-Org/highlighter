'use strict';
(() => {
  const el = id => document.getElementById(id);
  const projectId = new URLSearchParams(location.search).get('project') || 'default';
  let captured = [], pending = false;
  async function request(action, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type: `handles:${action}`, projectId, ...extra });
    if (result.error) throw new Error(result.error);
    captured = result.entries;
    const active = result.session?.active && result.session.projectId === projectId;
    el('capture-status').textContent = `${captured.length} unique handles saved · ${active ? `Capturing ${result.session.sourceUrl} — scroll that list to capture more` : 'Stopped'}${result.session?.projectId === projectId && result.session.error ? ` · ${result.session.error}` : ''}`;
    el('capture-stop').disabled = !active;
    for (const id of ['capture-use', 'capture-download', 'capture-clear']) el(id).disabled = !captured.length;
    return result;
  }
  async function perform(task) {
    if (pending) return;
    pending = true; el('capture-start').disabled = true; el('capture-error').textContent = '';
    try { await task(); } catch (error) { el('capture-error').textContent = error.message; }
    finally { pending = false; el('capture-start').disabled = false; }
  }
  el('capture-start').addEventListener('click', () => {
    let profile;
    try {
      profile = HighlightextFollows.profile(el('capture-profile').value, 'x');
      if (profile.platform !== 'x') throw new Error('Enter an X profile.');
    } catch (error) { el('capture-error').textContent = error.message; return; }
    // Call before any await so Firefox retains the click's permission gesture.
    perform(async () => {
      const granted = await chrome.permissions.request({ origins: ['https://x.com/*', 'https://twitter.com/*'] });
      if (!granted) throw new Error('Allow website access to capture this list.');
      await request('start', { url: `${profile.url}/${el('capture-list').value}` });
    });
  });
  el('capture-stop').addEventListener('click', () => perform(() => request('stop')));
  el('capture-clear').addEventListener('click', () => {
    if (confirm('Delete captured handles for this project? Capture will stop. The follow queue is kept.')) perform(() => request('clear'));
  });
  el('capture-use').addEventListener('click', () => {
    el('handles').value = captured.map(entry => `@${entry.handle}`).join('\n');
    el('platform').value = 'x';
    el('handles').scrollIntoView({ behavior: 'smooth', block: 'center' });
    el('import-status').textContent = 'Captured handles are ready below. Click Add to queue to import them.';
  });
  el('capture-download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([captured.map(entry => `@${entry.handle}`).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `highlightext-handles-${projectId}.txt`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  let timer;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.handleCaptureSession || changes.capturedHandles)) {
      clearTimeout(timer); timer = setTimeout(() => request('status').catch(error => { el('capture-error').textContent = error.message; }), 200);
    }
  });
  request('status').catch(error => { el('capture-error').textContent = error.message; });
})();
