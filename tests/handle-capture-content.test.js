const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('handle collector ignores stale startup state, captures after start, and disconnects on stop', async () => {
  let resolveStatus, storageChanged, captures = 0, listeners = 0, disconnected = 0, nextTimer = 0;
  const timers = new Map();
  const context = vm.createContext({
    location: { href: 'https://x.com/owner/followers' },
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { observe() {} disconnect() { disconnected++; } },
    HighlightextFollows: { listSource: () => ({ url: 'https://x.com/owner/followers' }), collectHandles: () => ['alice'] },
    chrome: {
      storage: { onChanged: { addListener: fn => { storageChanged = fn; listeners++; } } },
      runtime: { sendMessage: message => {
        if (message.type === 'handles:status') return new Promise(resolve => { resolveStatus = resolve; });
        captures++; assert.equal(message.sessionId, 'new-session'); return Promise.resolve({ active: true });
      } }
    }
  });
  const source = fs.readFileSync(require.resolve('../handle-capture-content'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(timers.size, 0);
  storageChanged({ handleCaptureSession: { newValue: { active: true, id: 'new-session', sourceUrl: 'https://x.com/owner/followers' } } }, 'local');
  resolveStatus({ session: null }); await Promise.resolve();
  assert.equal(timers.size, 1);
  const [id, callback] = timers.entries().next().value; timers.delete(id); callback();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(captures, 1);
  storageChanged({ handleCaptureSession: { newValue: { active: false, id: 'new-session', sourceUrl: 'https://x.com/owner/followers' } } }, 'local');
  assert.equal(timers.size, 0); assert.equal(disconnected, 1);
  vm.runInContext(source, context); assert.equal(listeners, 1);
});
