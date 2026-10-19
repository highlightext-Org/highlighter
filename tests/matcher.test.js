const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractTerms, createMatcher } = require('../matcher');
const term = (text, kind = 'keyword', caseSensitive = false) => ({ text, kind, caseSensitive, color: '#fde047' });

test('longest non-overlapping literal match with flexible case', () => {
  const match = createMatcher([term('risk'), term('risk factor'), term('a+b')]);
  assert.deepEqual(match('RISK FACTOR and a+b').map(m => [m.start, m.end]), [[0, 11], [16, 19]]);
});
test('Unicode whole-word boundaries and handles', () => {
  const match = createMatcher([term('cat'), term('@alice', 'handle')]);
  assert.deepEqual(match('cat scatter caté 猫cat @alice @alice_extra').map(m => m.start), [0, 22]);
});
test('case-sensitive wallets and category selection', () => {
  const terms = [term('AbC123', 'wallet', true), term('risk')];
  assert.equal(createMatcher(terms)('abc123 AbC123 RISK').length, 2);
  assert.equal(createMatcher(terms, { wallet: false, caseSensitive: true })('AbC123 RISK risk').length, 1);
});
test('substring option, UTF-16 offsets, and match cap', () => {
  assert.equal(createMatcher([term('cat')], { wholeWords: false })('scatter')[0].start, 1);
  assert.deepEqual(createMatcher([term('risk')])('😀 risk')[0].start, 3);
  assert.equal(createMatcher([term('x')])('x x x', 2).length, 2);
});
test('extracts enabled keywords and explicit identities, validates colors and schema', () => {
  const terms = extractTerms({ schema_version: 1, keywords: [
    { text: 'risk', variants: [{ keyword: { text: 'risk', color: 'red;bad' } }] },
    { text: 'hidden', variants: [{ keyword: { enabled: false } }] },
    { text: 'disabled', variants: [{ profile_id: 'off', keyword: {} }] }
  ], settings: [{ raw: { profiles: [{ id: 'off', enabled: false }] } }], profiles: [
    { x_handle: 'alice', x_handles: ['alice'], wallets: ['AbC'], profile_urls: ['https://example.org/alice'] }
  ] });
  assert.equal(terms.length, 5);
  assert.equal(terms[0].color, '#fde047');
  assert.equal(terms.find(t => t.kind === 'wallet').caseSensitive, true);
  assert.throws(() => extractTerms({ keywords: [], profiles: [] }), /schema/);
});
test('malicious-looking text is treated literally', () => {
  const text = '<img src=x onerror=alert(1)>';
  assert.equal(createMatcher([term(text)])(text)[0].end, text.length);
});
