(() => {
  'use strict';
  if (globalThis.__hextFocusedEditor) return;
  globalThis.__hextFocusedEditor = true;
  const documentId = crypto.randomUUID();
  let target = null, id = 0, revision = 0;
  function editable(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.closest('[data-hext-ui],[contenteditable="false"]')) return null;
    if (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'tel'].includes(node.type))) {
      if (node.disabled || node.readOnly || /password|cc-|one-time-code/i.test(node.autocomplete || '')) return null;
      return node;
    }
    if (!node.isContentEditable) return null;
    while (node.parentElement?.isContentEditable) node = node.parentElement;
    return node;
  }
  function activeElement() {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return node;
  }
  function track(node) {
    const next = editable(node);
    if (next !== target) { target = next; id++; revision++; }
  }
  function text() { return target.isContentEditable ? target.innerText : target.value; }
  function snapshot() {
    const active = activeElement();
    // Keep the last editor when focus moves to browser chrome or a formatting toolbar.
    if (active && active !== document.body && active !== document.documentElement &&
        (editable(active) || ['INPUT', 'TEXTAREA', 'IFRAME'].includes(active.tagName))) track(active);
    if (!target?.isConnected || !editable(target) || !target.getClientRects().length) return null;
    const value = text();
    return { id: `${documentId}:${id}`, revision, text: value.length <= 20000 ? value : '', tooLong: value.length > 20000 };
  }
  document.addEventListener('focusin', event => {
    const node = event.composedPath()[0];
    if (editable(node) || ['INPUT', 'TEXTAREA', 'IFRAME'].includes(node.tagName)) track(node);
  }, true);
  document.addEventListener('input', event => {
    const node = editable(event.composedPath()[0]);
    if (node && node === target) revision++;
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['editor:read', 'editor:replace'].includes(message.type)) return;
    try {
      const current = snapshot();
      if (message.type === 'editor:read') { respond({ editor: current }); return; }
      if (!current || current.id !== message.id || current.revision !== message.revision || current.text !== message.original || current.tooLong) {
        throw new Error('The page editor changed. Your latest text was kept.');
      }
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 40000) throw new Error('Invalid replacement text.');
      const field = target;
      field.focus();
      if (field.isContentEditable) {
        // Native editing updates rich editors such as X’s Draft.js composer and its undo history.
        const selection = field.ownerDocument.getSelection(), range = field.ownerDocument.createRange();
        range.selectNodeContents(field); selection.removeAllRanges(); selection.addRange(range);
        if (!document.execCommand('insertText', false, message.text)) throw new Error('This editor does not support automatic replacement.');
      } else {
        const before = new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertReplacementText', data: message.text });
        if (!field.dispatchEvent(before)) throw new Error('The page prevented text replacement.');
        const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, message.text);
        field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: message.text }));
      }
      revision++;
      if (text() !== message.text) throw new Error('The page did not accept the replacement. Review the page editor.');
      respond({ editor: snapshot() });
    } catch (error) { respond({ error: error.message }); }
  });
})();
