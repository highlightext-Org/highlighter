const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const granted of [true, false]) {
  test(`capture UI ${granted ? 'starts a list and prepares handles for review' : 'does not start when website access is denied'}`, async () => {
    const elements = new Map(), messages = [];
    let inClick = false;
    function element(id) {
      if (!elements.has(id)) elements.set(id, { value: '', listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, scrollIntoView() {} });
      return elements.get(id);
    }
    const entries = [{ handle: 'alice' }, { handle: 'bob' }];
    const context = vm.createContext({
      URLSearchParams, location: { search: '?project=default' }, HighlightextFollows: require('../follows'),
      document: { getElementById: element }, setTimeout, clearTimeout,
      chrome: {
        permissions: { request: async () => { assert(inClick, 'permission request must retain user gesture'); return granted; } },
        runtime: { sendMessage: async message => { messages.push(message); return { entries, session: null }; } },
        storage: { onChanged: { addListener() {} } }
      }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../handle-capture-ui'), 'utf8'), context);
    await new Promise(setImmediate);
    element('capture-profile').value = '@Owner'; element('capture-list').value = 'following';
    inClick = true; element('capture-start').listeners.click(); inClick = false;
    await new Promise(setImmediate);
    const start = messages.find(message => message.type === 'handles:start');
    if (granted) {
      assert.equal(start.url, 'https://x.com/owner/following');
      element('capture-use').listeners.click();
      assert.equal(element('handles').value, '@alice\n@bob');
      assert.equal(element('platform').value, 'x');
      assert(!messages.some(message => message.type === 'follow:add'), 'using captured handles requires an explicit Add to queue click');
    } else {
      assert.equal(start, undefined);
      assert.match(element('capture-error').textContent, /Allow website access/);
    }
    assert.equal(element('capture-start').disabled, false);
  });
}
