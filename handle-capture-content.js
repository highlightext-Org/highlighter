(() => {
  'use strict';
  if (globalThis.__highlightextHandleCaptureInstalled) return;
  globalThis.__highlightextHandleCaptureInstalled = true;
  let recording = null, timer, observer, busy = false, stateVersion = 0;
  function schedule() {
    if (recording?.active && !timer) timer = setTimeout(() => { timer = null; capture(); }, 250);
  }
  async function capture() {
    if (!recording?.active) return;
    if (busy) { schedule(); return; }
    busy = true;
    const session = recording;
    try {
      if (HighlightextFollows.listSource(location.href)?.url !== session.sourceUrl) return;
      const entries = HighlightextFollows.collectHandles(document, location.href);
      if (entries.length) {
        const result = await chrome.runtime.sendMessage({ type: 'handles:capture', sessionId: session.id, entries });
        if (result.error) throw new Error(result.error);
        if (!result.active && recording?.id === session.id) update(null);
      }
    } catch {
      // An extension reload invalidates old content scripts. Stop rather than poll forever.
      if (recording?.id === session.id) update(null);
    } finally { busy = false; }
  }
  function update(next) {
    stateVersion++;
    recording = next;
    clearTimeout(timer); timer = null; observer?.disconnect(); observer = null;
    if (!recording?.active) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    schedule();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.handleCaptureSession) update(changes.handleCaptureSession.newValue);
  });
  addEventListener('scroll', schedule, { passive: true, capture: true });
  addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  const initialVersion = stateVersion;
  chrome.runtime.sendMessage({ type: 'handles:status' }).then(result => {
    if (!result.error && stateVersion === initialVersion) update(result.session);
  }).catch(() => {});
})();
