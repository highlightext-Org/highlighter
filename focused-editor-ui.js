(() => {
  'use strict';
  const editor = document.getElementById('text');
  const toggle = document.getElementById('use-page-editor');
  const hint = document.getElementById('editor-source');
  let sequence = 0, polling = false, writing = false, windowId;
  const ready = chrome.windows.getCurrent().then(window => { windowId = window.id; });
  async function activeTab() {
    await ready;
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab?.id) throw new Error('Select a web page and click its text box.');
    return tab.id;
  }
  async function send(tabId, message) {
    let result;
    try { result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
    catch { throw new Error('Click a text box on the page. If needed, allow website access and reload the page.'); }
    if (result?.error) throw new Error(result.error);
    return result?.editor;
  }
  function preview(value) {
    if (editor.value === value) return;
    editor.value = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function show(source, error) {
    preview(source?.text || '');
    const previousHint = hint.textContent;
    hint.textContent = error || (source?.tooLong ? 'The page text exceeds the 20,000 character limit.' : source ? 'Using the page text box. Corrections will be applied there.' : 'Click a text box on the page to use its text automatically.');
    if (hint.textContent !== previousHint) globalThis.HextDiagnostics?.write('editor', error ? 'Could not read the focused page text box. Check website access and reload the page.' : source ? 'Focused page text box detected.' : 'Waiting for a focused page text box.', error ? 'error' : 'info');
  }
  const api = globalThis.HextFocusedEditor = {
    enabled: () => toggle.checked,
    async read() {
      const token = ++sequence;
      let source, error;
      try {
        const tabId = await activeTab();
        const value = await send(tabId, { type: 'editor:read' });
        if (value) source = { ...value, tabId };
      } catch (cause) { error = cause.message; }
      if (token === sequence && toggle.checked) show(source, error);
      if (error) throw new Error(error);
      return source;
    },
    async replace(source, text) {
      writing = true; sequence++;
      try {
        if (!toggle.checked || await activeTab() !== source.tabId) throw new Error('The active page changed. Your text was kept.');
        const value = await send(source.tabId, { type: 'editor:replace', id: source.id, revision: source.revision, original: source.text, text });
        if (!value) throw new Error('The page editor is no longer available.');
        sequence++;
        show(value);
        return { ...value, tabId: source.tabId };
      } finally { writing = false; sequence++; }
    }
  };
  toggle.addEventListener('change', () => {
    sequence++;
    editor.readOnly = toggle.checked;
    editor.placeholder = toggle.checked ? 'Click a text box on the page to preview its text here.' : 'Type or paste text here. Matches appear as you type.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (toggle.checked) poll();
    else hint.textContent = 'Using the side-panel draft. Type or paste text below.';
  });
  async function poll() {
    if (polling || writing || !toggle.checked) return;
    polling = true;
    try { await api.read(); } catch { /* read already displays actionable guidance */ }
    finally { polling = false; }
  }
  editor.readOnly = toggle.checked;
  editor.placeholder = 'Click a text box on the page to preview its text here.';
  poll();
  setInterval(poll, 500);
})();
