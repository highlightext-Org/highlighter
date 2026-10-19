const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../scripts/build');

test('both packages boot and load terms in their browser background environments', async t => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'highlightext-build-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  for (const browser of ['chrome', 'firefox']) {
    await t.test(browser, async () => {
      const destination = await build(browser, output);
      // Rebuilding removes old generated assets without touching the other target.
      await writeFile(path.join(destination, 'stale.js'), 'old');
      await build(browser, output);
      const files = await readdir(destination);
      assert(!files.includes('stale.js'));
      assert(!files.includes('tests'));
      assert(!files.includes('scripts'));
      const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
      assert.equal(manifest.manifest_version, 3);
      assert.deepEqual(manifest.permissions, browser === 'chrome' ? ['storage', 'activeTab', 'scripting', 'alarms', 'offscreen'] : ['storage', 'activeTab', 'scripting', 'alarms']);
      if (browser === 'firefox') {
        assert.equal(manifest.background.service_worker, undefined);
        assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
        assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
      } else {
        assert.equal(manifest.background.scripts, undefined);
        assert.equal(manifest.browser_specific_settings, undefined);
      }

      const sources = Object.fromEntries(await Promise.all(files.filter(file => file.endsWith('.js')).map(async file => [file, await readFile(path.join(destination, file), 'utf8')])));
      let listener;
      const stored = {};
      const context = vm.createContext({
        AbortSignal, TextDecoder,
        fetch: async () => ({ ok: true, json: async () => ({ schema_version: 1, keywords: [{ text: 'risk' }], profiles: [] }) }),
        chrome: {
          storage: { local: { get: async () => stored, set: async value => Object.assign(stored, value) } },
          runtime: { onMessage: { addListener: callback => { listener = callback; } } }
        }
      });
      if (browser === 'chrome') {
        context.importScripts = (...files) => files.forEach(file => vm.runInContext(sources[file], context));
        vm.runInContext(sources[manifest.background.service_worker], context);
      } else {
        for (const file of manifest.background.scripts) vm.runInContext(sources[file], context);
      }
      assert.equal(typeof listener, 'function');
      const response = await new Promise(resolve => {
        assert.equal(listener({ type: 'loadTerms' }, {}, resolve), true);
      });
      assert.equal(response.ok, true);
      assert.equal(response.terms[0].text, 'risk');
      assert.equal(stored.remoteRules[0].text, 'risk');
    });
  }
});

test('unsupported build targets are rejected', async () => {
  await assert.rejects(build('../unknown'), /Unknown browser/);
});
