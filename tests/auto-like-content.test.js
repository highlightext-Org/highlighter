const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../auto-like-content'), 'utf8');

function setup(hostname = 'x.com') {
  const listeners = {}, frames = new Map(), buttons = [];
  let changed, resolveConfig, next = 0, hit;
  const context = vm.createContext({
    location: { hostname }, innerHeight: 800, innerWidth: 1200,
    document: {
      visibilityState: 'visible', hasFocus: () => true,
      querySelectorAll: selector => { assert.match(selector, /button\[data-testid="like"\]/); return buttons; },
      elementFromPoint: () => hit,
      addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    requestAnimationFrame: fn => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: button => button.style,
    chrome: { storage: {
      local: { get: () => new Promise(resolve => { resolveConfig = resolve; }) },
      onChanged: { addListener: fn => { changed = fn; } }
    } }
  });
  vm.runInContext(source, context);
  return {
    context, listeners, frames,
    startup: config => resolveConfig({ config }),
    enable: value => changed({ config: { newValue: { autoLikeX: value } } }, 'local'),
    button(left = 200, id = '1') {
      const button = {
        clicks: 0, style: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
        getAttribute: () => null,
        closest: selector => selector.startsWith('article') ? { querySelector: () => ({ closest: () => ({ getAttribute: () => `/user/status/${id}` }) }) } : null,
        getBoundingClientRect: () => ({ left, right: left + 20, top: 200, bottom: 220, width: 20, height: 20 }),
        contains: target => target === button,
        click() { this.clicks++; }
      };
      buttons.push(button); hit = button; return button;
    },
    move(x, y = 210, extra = {}) { listeners.pointermove({ clientX: x, clientY: y, isTrusted: true, pointerType: 'mouse', buttons: 0, ...extra }); },
    flush() { for (const [id, fn] of frames) { frames.delete(id); fn(); } },
    cover() { hit = {}; }
  };
}

test('off by default; exact radius, nearest only, and no repeated clicks for remounted posts', () => {
  const app = setup(); const first = app.button();
  app.move(150); app.flush(); assert.equal(first.clicks, 0);
  app.enable(true);
  app.move(99); app.flush(); assert.equal(first.clicks, 0);
  app.move(100); app.flush(); assert.equal(first.clicks, 1);
  app.move(200); app.flush(); assert.equal(first.clicks, 1);
  const remount = app.button(200, '1');
  app.move(200); app.flush(); assert.equal(remount.clicks, 0);
});

test('disabling cancels queued action and stale startup cannot reenable it', async () => {
  const app = setup(); const button = app.button();
  app.enable(true); app.move(200); assert.equal(app.frames.size, 1);
  app.enable(false); app.startup({ autoLikeX: true }); await Promise.resolve();
  app.flush(); app.move(200); app.flush(); assert.equal(button.clicks, 0);
});

test('ignores covered, disabled, pressed, synthetic, touch and dragging interactions', () => {
  const app = setup(); const button = app.button(); app.enable(true);
  for (const extra of [{ isTrusted: false }, { pointerType: 'touch' }, { buttons: 1 }]) {
    app.move(200, 210, extra); app.flush();
  }
  button.disabled = true; app.move(200); app.flush(); button.disabled = false;
  button.getAttribute = name => name === 'aria-pressed' ? 'true' : null;
  app.move(200); app.flush(); button.getAttribute = () => null;
  app.cover(); app.move(200); app.flush(); assert.equal(button.clicks, 0);
});

test('scrolling and leaving the tab cancel pending clicks', () => {
  for (const event of ['scroll', 'pointerleave', 'blur', 'visibilitychange', 'pointerdown']) {
    const app = setup(); const button = app.button(); app.enable(true);
    app.move(200); app.listeners[event](); app.flush(); assert.equal(button.clicks, 0);
  }
});

test('one nearest eligible button per movement frame and no other platforms', () => {
  const app = setup('twitter.com'); const far = app.button(280, '2'), near = app.button(200, '3');
  app.enable(true); app.move(190); app.flush(); assert.equal(near.clicks, 1); assert.equal(far.clicks, 0);
  const other = setup('instagram.com'); assert.equal(other.listeners.pointermove, undefined);
});
