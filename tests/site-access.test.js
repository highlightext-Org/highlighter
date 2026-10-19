const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../site-access.js'), 'utf8');

for (const scope of ['x', undefined]) {
  test(`site access (${scope || 'all pages'}) requests within the click and permits retry after denial`, async () => {
    let click, granted = false, inClick = false;
    const requested = [];
    const button = { dataset: { scope }, addEventListener: (_, handler) => { click = handler; } };
    const status = {};
    vm.runInNewContext(source, {
      document: { getElementById: id => id === 'grant-site-access' ? button : status },
      chrome: { permissions: {
        contains: async () => false,
        request: ({ origins }) => {
          assert(inClick, 'request must happen synchronously within the user gesture');
          requested.push(Array.from(origins));
          return Promise.resolve(granted);
        }
      } }
    });
    await new Promise(setImmediate);
    assert.equal(button.hidden, false);
    assert.match(status.textContent, /Website access is needed/);
    async function press() {
      inClick = true;
      const pending = click();
      inClick = false;
      await pending;
    }
    await press();
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /not granted/);
    granted = true;
    await press();
    assert.equal(button.hidden, true);
    assert.match(status.textContent, /Reload open web pages/);
    assert.deepEqual(requested[0], scope === 'x'
      ? ['https://x.com/*', 'https://twitter.com/*']
      : ['http://*/*', 'https://*/*']);
  });
}

test('permission request errors leave the access button usable', async () => {
  let click;
  const button = { dataset: {}, addEventListener: (_, handler) => { click = handler; } };
  const status = {};
  vm.runInNewContext(source, {
    document: { getElementById: id => id === 'grant-site-access' ? button : status },
    chrome: { permissions: { contains: async () => false, request: async () => { throw new Error('Browser refused'); } } }
  });
  await new Promise(setImmediate);
  await click();
  assert.equal(button.disabled, false);
  assert.equal(button.hidden, false);
  assert.match(status.textContent, /Browser refused/);
});
