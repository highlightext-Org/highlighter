const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const handlers = {};
  let listener;
  const doc = {
    body: {}, documentElement: {}, activeElement: null,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command, _, text) { doc.activeElement.innerText = text; handlers.input({ composedPath: () => [doc.activeElement] }); return true; }
  };
  class Input {
    constructor(tagName = 'TEXTAREA', value = 'my speling') { Object.assign(this, { nodeType: 1, tagName, type: 'text', value, innerText: value, isConnected: true, ownerDocument: doc }); }
    closest() { return null; }
    getClientRects() { return [{}]; }
    focus() { doc.activeElement = this; handlers.focusin({ composedPath: () => [this] }); }
    dispatchEvent(event) { if (event.type === 'input') handlers.input({ composedPath: () => [this] }); return true; }
  }
  // Simulate the native setter used to notify React-controlled form fields.
  Object.defineProperty(Input.prototype, 'value', { get() { return this._value; }, set(value) { this._value = value; } });
  const context = vm.createContext({ document: doc, crypto: { randomUUID: () => 'document' },
    InputEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    HTMLTextAreaElement: Input, HTMLInputElement: Input,
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../focused-editor-content'), 'utf8'), context);
  const send = message => { let result; listener(message, {}, value => { result = value; }); return result; };
  const read = () => send({ type: 'editor:read' }).editor;
  return { doc, Input, handlers, read, send,
    replace(source, text) { return send({ type: 'editor:replace', ...source, original: source.text, text }); }
  };
}

test('captures the focused field, keeps it across sidebar blur, and replaces and undoes exact multiline text', () => {
  const app = setup(), field = new app.Input('TEXTAREA', 'my speling\nsecond line');
  field.focus();
  const original = app.read();
  app.doc.activeElement = app.doc.body;
  assert.equal(app.read().text, original.text);
  const result = app.replace(original, 'My spelling\nsecond line');
  assert.equal(result.editor.text, 'My spelling\nsecond line');
  assert.equal(field.value, result.editor.text);
  assert.equal(app.replace(result.editor, original.text).editor.text, original.text);
});

test('rejects stale results after typing, editing then reverting, switching fields, or closing the editor', () => {
  const app = setup(), field = new app.Input(); field.focus();
  const source = app.read();
  field.value = 'new draft'; field.dispatchEvent({ type: 'input' });
  assert.match(app.replace(source, 'Old result').error, /changed/);
  field.value = source.text; field.dispatchEvent({ type: 'input' });
  assert.match(app.replace(source, 'Old result').error, /changed/);
  const current = app.read(); new app.Input().focus();
  assert.match(app.replace(current, 'Old result').error, /changed/);
  field.focus(); const connected = app.read(); field.isConnected = false;
  assert.match(app.replace(connected, 'Old result').error, /changed/);
});

test('passwords, payment autofill, readonly and disabled fields are never captured', () => {
  const app = setup(); new app.Input().focus();
  for (const properties of [{ type: 'password' }, { autocomplete: 'cc-number' }, { autocomplete: 'one-time-code' }, { readOnly: true }, { disabled: true }]) {
    const field = Object.assign(new app.Input('INPUT', 'private'), properties); field.focus();
    assert.equal(app.read(), null);
  }
});

test('rich text editors use native insertion, preserve multiline text, and retain focus through toolbar clicks', () => {
  const app = setup(), field = new app.Input('DIV', 'a draft\nanother line'); field.isContentEditable = true;
  field.focus();
  const source = app.read();
  const toolbar = new app.Input('BUTTON'); toolbar.focus();
  assert.equal(app.read().id, source.id);
  assert.equal(app.replace(source, 'A draft\nanother line').editor.text, 'A draft\nanother line');
  assert.equal(field.innerText, 'A draft\nanother line');
});

test('oversized content is withheld and hidden fields are unavailable', () => {
  const app = setup(), field = new app.Input('TEXTAREA', 'a'.repeat(20001)); field.focus();
  assert.equal(app.read().tooLong, true); assert.equal(app.read().text, '');
  field.getClientRects = () => [];
  assert.equal(app.read(), null);
});
