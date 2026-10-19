const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../definitions');
const { createMatcher } = require('../matcher');
const rule = (id, text, extra = {}) => R.normalizeRule({ id, text, ...extra });

test('explicit and automatic rule types preserve literal metacharacters and legacy sentiments', () => {
  assert.equal(rule('a', 'a+b').type, 'literal');
  assert.equal(rule('b', '/a+/iu').type, 'regex');
  assert.equal(rule('c', '/literal/', { type: 'literal' }).text, '/literal/');
  assert.equal(R.normalizeRule({ pattern: 'a+' }).type, 'regex');
  assert.equal(rule('d', 'risk', { type: 'positive' }).type, 'literal');
  assert.throws(() => rule('e', '[', { type: 'regex' }));
  assert.throws(() => rule('f', 'x', { type: 'regex', flags: 'ii' }));
  assert.throws(() => rule('f', 'x', { type: 'regex', flags: 'uv' }));
});

test('central source supports patterns, grouped rules, legacy keywords, and disabled profiles', () => {
  const { rules, errors } = R.extractRules({ schema_version: 1, keywords: [{ text: 'risk', variants: [{ profile_id: 'off', keyword: { id: 'risk', enabled: true } }] }],
    profiles: [], settings: [{ raw: { profiles: [{ id: 'off', enabled: false, name: 'Campaign' }] } }],
    patterns: [{ id: 'number', pattern: '\\d+', flags: 'u' }, { pattern: '[' }],
    groups: [{ name: 'London', category: 'Location', rules: [{ id: 'town', text: 'London' }] }] });
  assert.equal(rules.find(item => item.id === 'risk').enabled, false);
  assert.equal(rules.find(item => item.id === 'town').group, 'London');
  assert.equal(rules.find(item => item.id === 'number').type, 'regex');
  assert.equal(errors.length, 1);
});

test('master keyword match_mode preserves regex variants and literal keyword behavior', async () => {
  const pattern = '\\b(?:City[\\s\\-./]*of[\\s\\-./]*Burbank|Burbank)\\b';
  const data = { schema_version: 1, profiles: [], keywords: [
    { text: pattern, match_mode: 'regex', variants: [
      { keyword: { text: pattern, match_mode: 'regex' }, origin: { source: 'places.txt', location: 'line:1' } },
      { keyword: { text: pattern, match_mode: 'regex' }, origin: { source: 'places.txt', location: 'line:2' } }
    ] },
    { text: '\\B\\S+  END', match_mode: 'regex', variants: [{ keyword: {} }] },
    { text: 'a+b', variants: [{ keyword: { text: 'a+b', type: 'positive' } }] },
    { text: 'standalone\\d+', match_mode: 'regex' },
    { text: '[', match_mode: 'regex' }
  ] };
  const { rules, errors } = R.extractRules(await R.readDefinitions(new Response(JSON.stringify(data))));
  assert.equal(errors.length, 1);
  assert.equal(rules.length, 4);
  assert.equal(rules.find(rule => rule.text === pattern).type, 'regex');
  assert.equal(rules.find(rule => rule.text === '\\B\\S+  END').type, 'regex');
  assert.equal(rules.find(rule => rule.text === 'a+b').type, 'literal');
  const text = 'CITY-of/Burbank a+b aaab standalone123';
  const active = R.resolveRules(rules);
  assert.deepEqual(createMatcher(active)(text).map(match => text.slice(match.start, match.end)),
    ['CITY-of/Burbank', 'a+b', 'standalone123']);
});

test('priority, disable overrides, group filters, and semantic deduplication', () => {
  const remote = [rule('remote', 'risk'), rule('other', 'city', { group: 'Location' })];
  const local = [rule('local', 'risk', { color: '#123456' })];
  let result = R.resolveRules(remote, local, {});
  assert.equal(result.find(item => item.text === 'risk').id, 'local');
  result = R.resolveRules(remote, local, { rules: [rule('project', 'risk')], disabledGroups: ['Location'] });
  assert.equal(result.length, 1); assert.equal(result[0].id, 'project');
  assert.equal(R.resolveRules(remote, [], { overrides: { remote: { enabled: false } }, disabledGroups: ['Location'] }).length, 0);
  assert.equal(R.deduplicate([rule('upper', '\\D', { type: 'regex', flags: 'i' }), rule('lower', '\\d', { type: 'regex', flags: 'i' })]).length, 2);
});

test('regex flags, Unicode offsets, boundaries, overlap priorities, and zero-width patterns', () => {
  const rules = [rule('literal', 'risk'), rule('pattern', 'risk \\d+', { type: 'regex', flags: 'u' }), rule('zero', '(?=.)', { type: 'regex', flags: 'u' })];
  let matches = createMatcher(rules)('😀 RISK 23 risked');
  assert.deepEqual(matches.map(item => [item.start, item.end]), [[3, 10]]);
  matches = createMatcher([rule('lines', '^a.+$', { type: 'regex', flags: 'm', wholeWords: false })])('x\nABC\ny');
  assert.equal(matches[0].start, 2);
  assert.equal(createMatcher([rule('case', 'abc', { type: 'regex', caseSensitive: true })])('ABC').length, 0);
  assert.equal(createMatcher([rule('part', 'cat', { wholeWords: false })])('scatter').length, 1);
  matches = createMatcher([{ ...rule('remote', 'risk factor'), priority: 0 }, { ...rule('project', 'risk', { type: 'regex' }), priority: 2 }])('risk factor');
  assert.equal(matches[0].term.id, 'project');
});

test('JSON and CSV imports round-trip quoted patterns, newlines, booleans, and boundary defaults', () => {
  const rules = [rule('quoted', 'a,"b"\nc', { wholeWords: false, enabled: false }), rule('regex', '\\d+,\\w+', { type: 'regex', flags: 'iu', caseSensitive: true })];
  assert.deepEqual(R.importRules(R.exportCSV(rules), 'csv'), rules);
  assert.deepEqual(R.importRules(JSON.stringify({ schema_version: 2, rules }), 'json'), rules);
  assert.throws(() => R.importRules('text,type\n[,regex', 'csv'));
  assert.throws(() => R.importRules('text\n"unclosed', 'csv'));
});

test('streaming parser handles chunk boundaries and UTF-8 while discarding unrelated datasets', async () => {
  const source = JSON.stringify({ schema_version: 1, holdings: [{ ignored: ['large', { nested: true }] }], rules: [rule('unicode', '猫😀'), rule('escape', '"\\\n')], patterns: ['a+'], settings: [] });
  const bytes = new TextEncoder().encode(source);
  const response = new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }));
  const parsed = await R.readDefinitions(response);
  assert.equal(parsed.holdings, undefined); assert.equal(parsed.rules[0].text, '猫😀');
  assert.deepEqual(parsed.rules, JSON.parse(source).rules);
  await assert.rejects(R.readDefinitions(new Response('{"rules":[')), /Incomplete/);
  await assert.rejects(R.readDefinitions(new Response(source), 8), /limit/);
});


test('same text in different campaign groups remains individually selectable', () => {
  const { rules } = R.extractRules({ groups: [
    { name: 'North', category: 'Issue', rules: ['risk'] },
    { name: 'South', category: 'Issue', rules: ['risk'] }
  ] });
  assert.equal(rules.length, 2); assert.notEqual(rules[0].id, rules[1].id);
  const active = R.resolveRules(rules, [], { disabledGroups: ['North'] });
  assert.equal(active.length, 1); assert.equal(active[0].group, 'South');
});

test('Python-style leading regex flags load Burbank sources without changing literal spelling matches', () => {
  const data = { keywords: [
    { text: '(?i)Burbank', match_mode: 'regex' },
    { text: '(?i)City\\s+of\\s+Burbank', match_mode: 'regex' },
    { text: '(?im)^Burbank$', match_mode: 'regex', flags: 'u' },
    { text: '(?i)literal', match_mode: 'literal' }
  ] };
  const { rules, errors } = R.extractRules(data);
  assert.equal(errors.length, 0);
  assert.equal(rules[0].text, 'Burbank');
  assert.equal(rules[0].flags, 'i');
  assert.equal(rules[2].flags, 'uim');
  assert.equal(rules[3].text, '(?i)literal');
  const match = createMatcher(R.resolveRules(rules));
  for (const text of ['Burbank', 'BURBANK', 'burbank', 'City of Burbank']) assert.equal(match(text).length, 1);
  assert.equal(match('Brubank').length, 0);
  assert.equal(match('Burbanker').length, 0);
  assert.equal(R.normalizeRule({ pattern: '(?i)(?m)^city$', flags: 'i' }).flags, 'im');
  for (const pattern of ['(?x)Burbank', '(?i)']) assert.throws(() => R.normalizeRule({ pattern }));
  assert.throws(() => R.normalizeRule({ pattern: '(?i)Burbank', flags: 'ii' }), /duplicate/);
});
