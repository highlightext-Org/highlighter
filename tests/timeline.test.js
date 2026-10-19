const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timeline');

test('timeline platforms and post URLs only accept supported HTTPS sites and canonical permalinks', () => {
  assert.equal(T.platform('https://x.com/home'), 'X');
  assert.equal(T.platform('https://www.instagram.com/'), 'Instagram');
  assert.equal(T.platform('https://www.tiktok.com/foryou'), 'TikTok');
  for (const url of ['http://x.com/', 'https://x.com.evil.example/', 'https://evil.example/', 'invalid']) assert.equal(T.platform(url), null);
  assert.equal(T.postURL('/alice/status/123/photo/1?x=1', 'https://x.com/home'), 'https://x.com/alice/status/123');
  assert.equal(T.postURL('/reel/abc/?x=1', 'https://www.instagram.com/'), 'https://www.instagram.com/reel/abc');
  assert.equal(T.postURL('/@alice/video/123?x=1', 'https://www.tiktok.com/'), 'https://www.tiktok.com/@alice/video/123');
  assert.equal(T.postURL('https://evil.example/alice/status/123', 'https://x.com/'), '');
  assert.equal(T.postURL('/alice', 'https://x.com/'), '');
});

test('normalization bounds content and retention deduplicates across timeline URLs', () => {
  const first = T.normalize({ text: 'hello', postUrl: '/a/status/1' }, 'https://x.com/home', 'p', 'now');
  const duplicate = T.normalize({ text: 'updated', postUrl: '/a/status/1' }, 'https://x.com/a', 'p', 'later');
  const other = T.normalize({ text: 'hello', postUrl: '/a/status/1' }, 'https://x.com/home', 'other', 'now');
  assert.equal(T.append([first], [duplicate, other, null]).records.length, 2);
  assert.equal(T.normalize({ text: '  ' }, 'https://x.com/', 'p', 'now'), null);
  assert.equal(T.normalize({ text: 'x'.repeat(13000) }, 'https://x.com/', 'p', 'now').text.length, 12000);
  let result = T.append([], Array.from({ length: T.MAX_RECORDS + 5 }, (_, i) => ({ key: `${i}`, text: 'x' })));
  assert.equal(result.records.length, T.MAX_RECORDS); assert.equal(result.dropped, 5); assert.equal(result.records[0].key, '5');
  result = T.append([], Array.from({ length: 300 }, (_, i) => ({ key: `${i}`, text: 'x'.repeat(12000) })));
  assert(result.records.length < 300);
  assert(JSON.stringify(result.records).length * 2 <= T.MAX_BYTES);
});

test('CSV preserves quotes and newlines and escapes untrusted spreadsheet formulas', () => {
  const csv = T.csv([{ platform: 'X', text: '=HYPERLINK("bad")\nnext', author: '@alice', projectId: 'p' }]);
  assert(csv.includes('"\'=HYPERLINK(""bad"")\nnext"'));
  assert(csv.includes('"\'@alice"'));
  assert(csv.includes('capturedAt'));
});

function documentWithCard(site, top = 0) {
  const href = site === 'X' ? 'https://x.com/a/status/123' : site === 'Instagram' ? 'https://www.instagram.com/p/abc/' : 'https://www.tiktok.com/@a/video/123';
  const anchor = { href };
  const time = { closest: () => anchor, getAttribute: () => '2026-10-18T12:00:00Z' };
  const card = {
    innerText: 'Author and post caption', getBoundingClientRect: () => ({ top, bottom: top + 200, width: 500, height: 200 }), closest: () => null,
    querySelectorAll: () => [anchor],
    querySelector: selector => selector === 'time' ? time : selector.includes('tweetText') ? { innerText: 'Tweet text' } : { innerText: 'Author' }
  };
  return { documentElement: { clientHeight: 900 }, querySelectorAll: selector => selector.startsWith('a[') ? [] : [card] };
}
test('all three timeline adapters capture visible post text, authors, links, and timestamps', () => {
  for (const [site, source] of [['X', 'https://x.com/home'], ['Instagram', 'https://www.instagram.com/'], ['TikTok', 'https://www.tiktok.com/foryou']]) {
    const posts = T.collect(documentWithCard(site), source);
    assert.equal(posts.length, 1); assert.equal(posts[0].author, 'Author');
    assert.equal(posts[0].publishedAt, '2026-10-18T12:00:00Z');
    assert(posts[0].postUrl); assert(posts[0].text);
    assert.equal(T.collect(documentWithCard(site, 1000), source).length, 0);
    assert.equal(T.collect(documentWithCard(site, -300), source).length, 0);
  }
});
