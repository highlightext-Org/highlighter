'use strict';
const { copyFile, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = ['site-access.js', 'background.js', 'content.js', 'matcher.js', 'popup.js', 'popup.html', 'popup.css', 'LICENSE', 'DISCLAIMER.md', 'definitions.js', 'chrome-host.js', 'worker-host.js', 'match-worker.js', 'offscreen.html', 'offscreen.js', 'options.html', 'options.js', 'options.css', 'timeline.js', 'timeline-content.js', 'sidebar.js', 'follows.js', 'follow.html', 'follow.css', 'follow.js', 'follow-action.js'];

async function build(target, outputRoot = path.join(root, 'dist')) {
  if (!['chrome', 'firefox'].includes(target)) throw new Error(`Unknown browser: ${target}. Use chrome or firefox.`);
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (target === 'firefox') {
    const overrides = JSON.parse(await readFile(path.join(root, 'manifests/firefox.json'), 'utf8'));
    Object.assign(manifest, overrides);
    delete manifest.minimum_chrome_version;
    delete manifest.side_panel;
  }
  const destination = path.join(outputRoot, target);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    if (target === 'firefox' && ['chrome-host.js', 'offscreen.html', 'offscreen.js'].includes(file)) continue;
    await copyFile(path.join(root, file), path.join(destination, file));
  }
  if (target === 'firefox') await copyFile(path.join(root, 'manifests/firefox-sidebar.js'), path.join(destination, 'sidebar.js'));
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return destination;
}

if (require.main === module) {
  (async () => {
    const targets = process.argv.slice(2);
    if (targets.some(target => !['chrome', 'firefox'].includes(target))) {
      throw new Error('Usage: node scripts/build.js [chrome|firefox]');
    }
    for (const target of targets.length ? targets : ['chrome', 'firefox']) {
      console.log(`Built ${target}: ${await build(target)}`);
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { build };
