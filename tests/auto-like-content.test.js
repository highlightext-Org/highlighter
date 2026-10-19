const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../auto-like-content'), 'utf8');

function setup(hostname = 'x.com') {
  const listeners = {}, frames = new Map();
  let changed, resolveConfig, next = 0;
  const context = vm.createContext({
    location: { hostname }, innerHeight: 800, innerWidth: 1200,
    document: {
      visibilityState: 'visible', hasFocus: () => true,
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
        clicks: 0, isConnected: true, matches: () => true, style: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
        getAttribute: () => null,
        closest: selector => selector === 'article[data-testid="tweet"] button[data-testid="like"]' ? button : selector.startsWith('article') ? { querySelector: () => ({ closest: () => ({ getAttribute: () => `/user/status/${id}` }) }) } : null,
        getBoundingClientRect: () => ({ left, right: left + 20, top: 200, bottom: 220, width: 20, height: 20 }),
        contains: target => target === button,
        click() { this.clicks++; }
      };
      return button;
    },
    hover(target, extra = {}) { listeners.pointerover({ target, isTrusted: true, pointerType: 'mouse', buttons: 0, ...extra }); },
    leave(relatedTarget = null) { listeners.pointerout({ relatedTarget }); },
    flush() { for (const [id, fn] of frames) { frames.delete(id); fn(); } }

  };
}

test('only hovering a Like button triggers a like; defaults off and skips remounted posts', () => {
  const app = setup(); const first = app.button();
  app.hover(first); app.flush(); assert.equal(first.clicks, 0);
  app.enable(true);
  app.hover({ closest: () => null }); app.flush(); assert.equal(first.clicks, 0);
  app.hover(first); app.flush(); assert.equal(first.clicks, 1);
  app.leave(); app.hover(first); app.flush(); assert.equal(first.clicks, 1);
  const remount = app.button(200, '1');
  app.hover(remount); app.flush(); assert.equal(remount.clicks, 0);
});

test('disabling cancels queued action and stale startup cannot reenable it', async () => {
  const app = setup(); const button = app.button();
  app.enable(true); app.hover(button); assert.equal(app.frames.size, 1);
  app.enable(false); app.startup({ autoLikeX: true }); await Promise.resolve();
  app.flush(); app.hover(button); app.flush(); assert.equal(button.clicks, 0);
});

test('ignores disabled, pressed, detached, synthetic, touch and dragging interactions', () => {
  const app = setup(); const button = app.button(); app.enable(true);
  for (const extra of [{ isTrusted: false }, { pointerType: 'touch' }, { buttons: 1 }]) {
    app.hover(button, extra); app.flush();
  }
  button.disabled = true; app.hover(button); app.flush(); app.leave(); button.disabled = false;
  button.getAttribute = name => name === 'aria-pressed' ? 'true' : null;
  app.hover(button); app.flush(); app.leave(); button.getAttribute = () => null;
  button.isConnected = false; app.hover(button); app.flush(); assert.equal(button.clicks, 0);
});

test('scrolling and leaving the tab or button cancel pending clicks', () => {
  for (const event of ['scroll', 'pointerleave', 'blur', 'visibilitychange', 'pointerdown', 'pointerout']) {
    const app = setup(); const button = app.button(); app.enable(true);
    app.hover(button); app.listeners[event]({ relatedTarget: null }); app.flush(); assert.equal(button.clicks, 0);
  }
});

test('nested icons trigger hover and moving within the button preserves the pending click', () => {
  const app = setup(); const button = app.button(); app.enable(true);
  app.hover({ closest: () => button }); app.leave(button); app.flush(); assert.equal(button.clicks, 1);
});

test('only the currently hovered button is clicked and other platforms are ignored', () => {
  const app = setup('twitter.com'); const first = app.button(280, '2'), second = app.button(200, '3');
  app.enable(true); app.hover(first); app.leave(); app.hover(second); app.flush();
  assert.equal(second.clicks, 1); assert.equal(first.clicks, 0);
  const other = setup('instagram.com'); assert.equal(other.listeners.pointerover, undefined);
});
