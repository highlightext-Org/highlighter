const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const vm = require('node:vm');
function host() {
  const context = vm.createContext({ setTimeout, clearTimeout, chrome: { runtime: { getURL: () => '' } }, Worker: class {
    constructor() {
      this.worker = new Worker(`const { parentPort } = require('node:worker_threads'); const vm = require('node:vm'); const fs = require('node:fs'); const scope = {self: {postMessage: value => parentPort.postMessage(value)}, importScripts: () => { scope.Highlightext = require(${JSON.stringify(require.resolve('../matcher'))}); }}; vm.runInNewContext(fs.readFileSync(${JSON.stringify(require.resolve('../match-worker'))}, 'utf8'), scope); parentPort.on('message', data => scope.self.onmessage({data}));`, { eval: true });
      this.worker.on('message', data => this.onmessage?.({ data })); this.worker.on('error', error => this.onerror?.(error));
    }
    postMessage(data) { this.worker.postMessage(data); }
    terminate() { this.worker.terminate(); }
  } });
  vm.runInContext(fs.readFileSync(require.resolve('../worker-host'), 'utf8'), context);
  return context.runMatchJob;
}
test('matching worker is terminated on catastrophic regex and a subsequent safe scan succeeds', async () => {
  const run = host();
  await assert.rejects(run({ rules: [{ id: 'slow', text: '(a+)+$', type: 'regex', wholeWords: false }], options: {}, texts: ['a'.repeat(100) + '!'] }), /75 ms budget/);
  const result = await run({ rules: [{ id: 'safe', text: '\\d+', type: 'regex', wholeWords: false }], options: {}, texts: ['count 123'] });
  assert.equal(result.results[0][0].start, 6);
});

test('worker scans 674 regex patterns while retaining the pattern limit', async () => {
  const { MAX_REGEX_RULES } = require('../matcher');
  const rules = Array.from({ length: 674 }, (_, i) =>
    ({ id: `place-${i}`, text: `\\bplace[\\s-]*${i}\\b`, type: 'regex' }));
  const run = host();
  const result = await run({ rules, options: {}, texts: ['PLACE-673 place 0'] });
  assert.equal(result.results[0].length, 2);
  await assert.rejects(run({ rules: Array(MAX_REGEX_RULES + 1).fill(rules[0]), options: {}, texts: ['place 0'] }), /at most 1000/);
});
