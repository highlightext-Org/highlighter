const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../content'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(enabled = true) {
  let storageListener, observer, pendingScan;
  const scans = [], elements = [], highlights = new Map();
  const settings = { enabled, projectId: 'default' };
  const context = vm.createContext({
    setTimeout, clearTimeout, CSS: { highlights }, Highlight: class {},
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
    document: {
      body: { append() {} }, head: { append() {} },
      createTreeWalker: () => ({ nextNode: () => null }),
      createElement: () => {
        const element = { dataset: {}, style: {}, setAttribute() {}, remove() { this.removed = true; } };
        elements.push(element); return element;
      }
    },
    chrome: {
      storage: { onChanged: { addListener: fn => { storageListener = fn; } } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.type === 'hext:settings') return { ...settings };
        scans.push(message);
        if (pendingScan) await pendingScan;
        return { results: [], capped: false };
      } }
    }
  });
  vm.runInContext(source, context);
  return { settings, scans, elements, observer: () => observer,
    change: changes => storageListener(changes, 'local'),
    holdScan: promise => { pendingScan = promise; } };
}
test('highlighting starts without popup, tracks the project, and clears when switched off', async () => {
  const app = setup(); await tick();
  assert.equal(app.scans.length, 1);
  assert.equal(app.scans[0].projectId, 'default');
  assert.equal(app.observer().active, true);
  app.settings.projectId = 'campaign'; app.change({ config: {} }); await tick();
  assert.equal(app.scans.at(-1).projectId, 'campaign');
  app.settings.enabled = false; app.change({ config: {} }); await tick();
  assert.equal(app.observer().active, false);
  assert(app.elements.every(element => element.removed));
});
test('disabled pages stay idle and a scan finishing after disabling cannot restore highlights', async () => {
  const app = setup(false); await tick();
  assert.equal(app.scans.length, 0);
  let finish;
  app.holdScan(new Promise(resolve => { finish = resolve; }));
  app.settings.enabled = true; app.change({ config: {} }); await tick();
  assert.equal(app.scans.length, 1);
  app.settings.enabled = false; app.change({ config: {} }); await tick();
  finish(); await tick();
  assert.equal(app.elements.length, 0);
  assert.equal(app.observer().active, false);
});
