const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(setImmediate);
async function setup() {
  const nodes = {}, messages = [];
  let poll, activeId = 4, source = { id: 'document:1', revision: 1, text: 'page draft' }, answer;
  const node = id => nodes[id] ||= { checked: true, value: '', handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, dispatchEvent() {} };
  const context = vm.createContext({ document: { getElementById: node }, Event: class {}, setInterval: fn => { poll = fn; },
    chrome: { windows: { getCurrent: async () => ({ id: 2 }) }, tabs: {
      query: async query => { assert.equal(query.windowId, 2); return [{ id: activeId }]; },
      sendMessage: async (tabId, message, options) => {
        assert.equal(options.frameId, 0); messages.push({ tabId, ...message });
        if (answer) return answer(message);
        if (message.type === 'editor:replace') source = { ...source, text: message.text, revision: source.revision + 1 };
        return { editor: source };
      }
    } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../focused-editor-ui'), 'utf8'), context);
  await tick();
  return { node, messages, api: context.HextFocusedEditor, poll,
    tab: value => { activeId = value; }, source: value => { source = value; }, respond: fn => { answer = fn; } };
}

test('automatically previews the current page field and follows typing and active tabs', async () => {
  const app = await setup();
  assert.equal(app.node('text').value, 'page draft'); assert.equal(app.node('text').readOnly, true);
  app.source({ text: 'new typing', id: 'document:1', revision: 2 }); await app.poll();
  assert.equal(app.node('text').value, 'new typing');
  app.tab(5); app.source(null); await app.poll();
  assert.equal(app.node('text').value, '');
  assert.match(app.node('editor-source').textContent, /Click a text box/);
  assert.equal(app.messages.at(-1).tabId, 5);
});

test('manual mode stops polling and prevents page writes; switching tabs also prevents writes', async () => {
  const app = await setup(), original = await app.api.read();
  app.node('use-page-editor').checked = false; app.node('use-page-editor').handlers.change();
  const count = app.messages.length; await app.poll(); assert.equal(app.messages.length, count);
  assert.equal(app.node('text').readOnly, false);
  await assert.rejects(app.api.replace(original, 'replacement'), /changed/);
  app.node('use-page-editor').checked = true; app.tab(8);
  await assert.rejects(app.api.replace(original, 'replacement'), /changed/);
  assert(!app.messages.some(message => message.type === 'editor:replace'));
});

test('replacement passes the identity and revision and updates the preview', async () => {
  const app = await setup(), original = await app.api.read();
  const result = await app.api.replace(original, 'Corrected text');
  assert.equal(app.node('text').value, 'Corrected text');
  assert.equal(result.revision, 2);
  const write = app.messages.at(-1);
  assert.equal(write.original, 'page draft'); assert.equal(write.id, original.id); assert.equal(write.revision, original.revision);
});

test('an old poll cannot overwrite the result of a newer page read', async () => {
  const app = await setup(); let resolve;
  app.respond(() => new Promise(done => { resolve = done; }));
  const pending = app.poll(); await tick();
  app.respond(async () => ({ editor: { text: 'Latest draft' } })); await app.api.read();
  resolve({ editor: { text: 'Stale draft' } }); await pending;
  assert.equal(app.node('text').value, 'Latest draft');
});
