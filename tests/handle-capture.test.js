const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../follows');

test('X list URLs exclude posts, unrelated pages, credentials, and lookalike hosts', () => {
  assert.equal(F.listSource('https://twitter.com/Owner/followers?test=1').url, 'https://x.com/owner/followers');
  assert.equal(F.listSource('https://x.com/owner/verified_followers').list, 'verified_followers');
  for (const url of ['https://x.com/home', 'https://x.com/a/status/1', 'https://x.com.evil/a/followers', 'http://x.com/a/followers', 'https://user@x.com/a/followers']) assert.equal(F.listSource(url), null);
});

test('collector reads visible account identity links and ignores bio mentions, hidden cells, and post links', () => {
  const anchor = (href, label) => ({ getAttribute: () => href, textContent: label, querySelectorAll: () => [] });
  const cell = (links, rect = {}, hidden = false) => ({
    getBoundingClientRect: () => ({ width: 300, height: 80, top: 20, bottom: 100, ...rect }),
    closest: () => hidden, querySelectorAll: () => links
  });
  const doc = {
    documentElement: { clientHeight: 800 },
    querySelectorAll: selector => {
      assert.equal(selector, '[data-testid="primaryColumn"] [data-testid="UserCell"]');
      return [
        cell([anchor('/alice/status/1', '@alice'), anchor('/mentioned', 'My friend @mentioned'), anchor('/Alice', '@Alice')]),
        cell([anchor('https://twitter.com/alice', '@alice')]),
        cell([anchor('/bob', '@bob')]),
        cell([anchor('/hidden', '@hidden')], {}, true),
        cell([anchor('/offscreen', '@offscreen')], { top: 900, bottom: 980 }),
        cell([anchor('https://evil.example/fake', '@fake')])
      ];
    }
  };
  assert.deepEqual(F.collectHandles(doc, 'https://x.com/owner/followers'), ['alice', 'bob']);
  assert.deepEqual(F.collectHandles(doc, 'https://x.com/home'), []);
});
