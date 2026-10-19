const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../follows');
const { followXProfile } = require('../follow-action');

test('handle lists normalize mixed platforms, remove duplicates, and report invalid entries', () => {
  const result = F.parse('@Alice,https://twitter.com/ALICE;insta:bob\nfb:charlie tiktok:delta');
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.entries.map(entry => entry.key), ['x:alice', 'instagram:bob', 'facebook:charlie', 'tiktok:delta']);
  assert.equal(result.entries[3].url, 'https://www.tiktok.com/@delta');
  assert.equal(F.parse('alice', 'instagram').entries[0].platform, 'instagram');
  assert.equal(F.parse('https://www.instagram.com/alice/?utm_source=test').entries[0].handle, 'alice');
  for (const text of ['https://x.com.evil.example/alice', 'https://x.com/alice/status/1', 'https://x.com/home', 'https://instagram.com/p/123', 'https://www.facebook.com/profile.php?id=1', 'https://tiktok.com/alice', 'http://x.com/alice', 'javascript:alert(1)', 'https://user:pass@x.com/alice', 'https://x.com:444/alice', '@toolongusernameforx']) {
    assert.equal(F.parse(text).errors.length, 1, text);
  }
  assert.throws(() => F.parse('a'.repeat(100001)), /100,000/);
  assert.throws(() => F.parse(Array(1002).fill('a').join(' ')), /1,000/);
});

test('X action refuses wrong profiles and dialogs, avoids unfollowing, and confirms follows', async t => {
  const original = { location: global.location, document: global.document, setTimeout: global.setTimeout };
  t.after(() => Object.assign(global, original));
  global.location = { hostname: 'x.com', pathname: '/alice' };
  let clicked = 0, following = false, dialog = false, buttons = [];
  const actions = {
    querySelectorAll: () => buttons,
    querySelector: selector => following && selector === '[data-testid="123-unfollow"]' ? {} : null
  };
  const main = { querySelector: selector => selector.includes('UserName') ? {} : { parentElement: actions } };
  global.document = { querySelector: selector => selector.includes('primaryColumn') ? main : dialog ? {} : null };
  assert.equal((await followXProfile('bob')).status, 'blocked');
  dialog = true; assert.equal((await followXProfile('alice')).status, 'blocked'); dialog = false;
  buttons = [{ dataset: { testid: '123-unfollow' } }];
  assert.equal((await followXProfile('alice')).status, 'already-following');
  buttons = [{ dataset: { testid: '123-cancel' } }];
  assert.equal((await followXProfile('alice')).status, 'requested');
  buttons = [{ dataset: { testid: '123-follow' }, click: () => { clicked++; following = true; } }];
  global.setTimeout = fn => { fn(); };
  assert.equal((await followXProfile('alice')).status, 'followed'); assert.equal(clicked, 1);
  following = false; buttons[0].click = () => { clicked++; };
  assert.equal((await followXProfile('alice')).status, 'blocked'); assert.equal(clicked, 2);
});

test('location check opens the account About link and matches only labeled account fields', async t => {
  const { checkXRequirements } = require('../follow-action');
  const original = { location: global.location, document: global.document, setTimeout: global.setTimeout };
  t.after(() => Object.assign(global, original));
  global.location = { hostname: 'x.com', origin: 'https://x.com', href: 'https://x.com/alice', pathname: '/alice' };
  global.setTimeout = fn => fn();
  let country = 'United States', source = 'United States App Store', available = true, heading = true, opened = 0;
  const link = { href: 'https://x.com/alice/about', click() { opened++; global.location.pathname = '/alice/about'; } };
  const main = { querySelector: () => ({}), querySelectorAll(selector) {
    if (selector === 'a[href]') return available ? [link] : [];
    if (selector.includes('heading')) return heading ? [{ innerText: 'About this account' }] : [];
    return [
      { innerText: 'Account based in', parentElement: { innerText: `Account based in\n${country}` } },
      { innerText: 'Connected via', parentElement: { innerText: `Connected via\n${source}` } }
    ];
  } };
  global.document = { querySelector: selector => selector.includes('primaryColumn') ? main : null };
  const requirements = { basedIn: 'United States', connectedVia: 'United States App Store' };
  const check = async () => { global.location.pathname = '/alice'; return checkXRequirements('alice', requirements); };
  assert.equal((await check()).status, 'matched');
  assert.equal(opened, 1);
  country = 'India'; assert.equal((await check()).status, 'skipped');
  country = 'United States'; source = 'United States Android App';
  assert.equal((await check()).status, 'skipped');
  source = '  UNITED STATES   App Store '; assert.equal((await check()).status, 'matched');
  country = ''; assert.equal((await check()).status, 'blocked');
  country = 'United States'; heading = false;
  assert.equal((await check()).status, 'blocked');
  heading = true; available = false;
  assert.equal((await check()).status, 'blocked');
  assert.equal((await checkXRequirements('bob', requirements)).status, 'blocked');
});
