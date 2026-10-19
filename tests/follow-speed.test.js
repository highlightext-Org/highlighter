const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const F = require('../follows');

async function setup(speed = 'normal') {
  const elements = new Map(), waits = [], sent = [];
  let onTick = () => {}, failSave = false;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', listeners: {}, setAttribute() {}, append() {}, replaceChildren() {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return elements.get(id);
  }
  const context = vm.createContext({
    URLSearchParams, location: { search: '?project=default' }, HighlightextFollows: F,
    document: { getElementById: element, createElement: () => element('new') },
    navigator: { locks: {} },
    setTimeout: (fn, ms) => { waits.push(ms); onTick(waits.length); fn(); },
    chrome: {
      tabs: { get: async () => ({ status: 'complete' }) },
      runtime: { sendMessage: async message => {
        sent.push(message);
        if (message.type === 'getState') return { config: { projects: { default: { name: 'Default' } } } };
        if (message.type === 'follow:speed' && failSave) return { error: 'Storage failed' };
        return { entries: [], speed: message.speed || speed };
      } }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../follow'), 'utf8'), context);
  await new Promise(setImmediate);
  return { context, elements, waits, sent, tick: fn => { onTick = fn; }, fail: () => { failSave = true; } };
}

for (const speed of ['slow', 'normal', 'fast']) {
  test(`${speed} setting applies to account pauses and profile settling`, async () => {
    const app = await setup(speed);
    await vm.runInContext('pauseBetweenAccounts()', app.context);
    assert.equal(app.waits.reduce((sum, ms) => sum + ms, 0), F.SPEEDS[speed].pauseMs);
    app.waits.length = 0;
    await vm.runInContext('waitForProfile(1)', app.context);
    assert.deepEqual(app.waits, [F.SPEEDS[speed].settleMs]);
  });
}

test('changing speed shortens the current pause and Stop exits on the next tick', async () => {
  const app = await setup('slow');
  app.tick(count => { if (count === 5) vm.runInContext("followSpeed = 'fast'", app.context); });
  await vm.runInContext('pauseBetweenAccounts()', app.context);
  assert.equal(app.waits.length, 40);
  app.waits.length = 0;
  app.tick(count => { if (count === 3) vm.runInContext('stopRequested = true', app.context); });
  await vm.runInContext('pauseBetweenAccounts()', app.context);
  assert.equal(app.waits.length, 3);
});

test('speed slider updates live, saves the choice, and restores saved speed on failure', async () => {
  const app = await setup();
  const slider = app.elements.get('follow-speed');
  slider.value = '2'; slider.listeners.input();
  assert.match(app.elements.get('speed-status').textContent, /Fast · 10 seconds/);
  await slider.listeners.change();
  assert.equal(app.sent.at(-1).speed, 'fast');
  app.fail(); slider.value = '0'; slider.listeners.input();
  await slider.listeners.change();
  assert.equal(vm.runInContext('followSpeed', app.context), 'fast');
  assert.equal(slider.disabled, false);
  assert.equal(app.elements.get('error').textContent, 'Storage failed');
});
