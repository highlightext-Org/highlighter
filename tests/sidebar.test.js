const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Chrome opens the panel in the popup window and Firefox opens synchronously from the click', async () => {
  let opened;
  const chrome = vm.createContext({ chrome: {
    windows: { getCurrent: async () => ({ id: 17 }) },
    sidePanel: { open: async options => { opened = options.windowId; } }
  } });
  vm.runInContext(fs.readFileSync(require.resolve('../sidebar'), 'utf8'), chrome);
  await chrome.openHighlightextSidebar(); assert.equal(opened, 17);
  opened = false;
  const firefox = vm.createContext({ browser: { sidebarAction: { open: () => { opened = true; return Promise.resolve(); } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../manifests/firefox-sidebar'), 'utf8'), firefox);
  const result = firefox.openHighlightextSidebar();
  assert.equal(opened, true); await result;
});
