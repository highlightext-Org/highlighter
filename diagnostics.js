// Only fixed step descriptions and numeric status codes belong in this log.
// Never pass API keys, page text, request bodies, or provider response bodies.
(() => {
  'use strict';
  // Firefox background event pages also have a document, but no panel controls.
  const output = typeof document !== 'undefined' ? document.getElementById('diagnostic-output') : null;
  const inUI = Boolean(output);
  let entries = [], activeRequest;
  const listeners = new Set();
  function append(entry) {
    entries.push(entry);
    entries = entries.slice(-200);
    for (const listener of listeners) {
      try { listener(entries); } catch { /* Diagnostics must never block extension operations. */ }
    }
  }
  const api = globalThis.HextDiagnostics = {
    begin() { activeRequest = crypto.randomUUID(); return activeRequest; },
    write(stage, message, level = 'info', requestId) {
      const entry = { time: new Date().toISOString(), stage, message, level };
      if (inUI) append(entry);
      else if (requestId) {
        try { chrome.runtime.sendMessage({ target: 'hext-diagnostics', requestId, entry }).catch(() => {}); }
        catch { /* Closing the sidebar must not interrupt correction. */ }
      }
    },
    subscribe(listener) { listeners.add(listener); listener(entries); },
    clear() { entries = []; for (const listener of listeners) listener(entries); }
  };
  if (!inUI) return;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.tab || message?.target !== 'hext-diagnostics' || message.requestId !== activeRequest) return;
    const entry = message.entry;
    if (entry && ['info', 'error'].includes(entry.level) && typeof entry.message === 'string' && typeof entry.stage === 'string') append(entry);
  });
  api.subscribe(rows => {
    output.textContent = rows.map(row => `${row.time.slice(11, 23)} ${row.level.toUpperCase()} [${row.stage}] ${row.message}`).join('\n');
    document.getElementById('diagnostic-count').textContent = `${rows.length} entries`;
    output.scrollTop = output.scrollHeight;
  });
  document.getElementById('diagnostic-clear').addEventListener('click', () => api.clear());
  document.getElementById('diagnostic-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      document.getElementById('diagnostic-action-status').textContent = 'Logs copied.';
    } catch { document.getElementById('diagnostic-action-status').textContent = 'Copy unavailable. Select the log text and copy it manually.'; }
  });
  window.addEventListener('error', event => {
    const file = String(event.filename || '').split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '');
    api.write('script', `Script error in ${file || 'extension'} at line ${Number(event.lineno) || 0}.`, 'error');
  });
  window.addEventListener('unhandledrejection', () => api.write('script', 'An extension operation failed without an error handler.', 'error'));
  api.write('startup', `Highlightext ${chrome.runtime.getManifest().version}. Logs stay in this panel and exclude keys and text.`);
})();
