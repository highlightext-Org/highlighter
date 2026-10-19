const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../auto-follow-content'), 'utf8');

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
    enable: value => changed({ config: { newValue: { autoFollowX: value } } }, 'local'),
    button(left = 200, id = '1') {
      const button = {
        clicks: 0, isConnected: true, matches: () => true, style: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
        getAttribute: name => name === 'data-testid' ? `${id}-follow` : null,
        closest: selector => selector === 'button[data-testid$="-follow"]' ? button : null,
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

test('only hovering a Follow button triggers a follow; defaults off and skips remounted accounts', () => {
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
  app.enable(false); app.startup({ autoFollowX: true }); await Promise.resolve();
  app.flush(); app.hover(button); app.flush(); assert.equal(button.clicks, 0);
});

test('ignores disabled, pressed, detached, synthetic, touch and dragging interactions', () => {
  const app = setup(); const button = app.button(); app.enable(true);
  for (const extra of [{ isTrusted: false }, { pointerType: 'touch' }, { buttons: 1 }]) {
    app.hover(button, extra); app.flush();
  }
  button.disabled = true; app.hover(button); app.flush(); app.leave(); button.disabled = false;
  button.getAttribute = name => name === 'aria-pressed' ? 'true' : name === 'data-testid' ? '1-follow' : null;
  app.hover(button); app.flush(); app.leave(); button.getAttribute = name => name === 'data-testid' ? '1-follow' : null;
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

test('Following, pending requests, and unrelated buttons never trigger follows', () => {
  const app = setup(); app.enable(true);
  for (const testid of ['1-unfollow', '1-cancel', 'follow', 'unrelated-follow', null]) {
    const button = app.button();
    button.getAttribute = name => name === 'data-testid' ? testid : null;
    app.hover(button); app.flush(); app.leave();
    assert.equal(button.clicks, 0);
  }
});

test('rechecks follow state before clicking and installation is idempotent', () => {
  const app = setup(); app.enable(true);
  const button = app.button(); app.hover(button);
  button.getAttribute = name => name === 'data-testid' ? '1-unfollow' : null;
  app.flush(); assert.equal(button.clicks, 0);
  const over = app.listeners.pointerover;
  vm.runInContext(source, app.context);
  assert.equal(app.listeners.pointerover, over);
});


test('saved hover setting starts working immediately and reinjection resyncs it without duplicate listeners', async () => {
  const app = setup();
  app.startup({ autoFollowX: true }); await Promise.resolve();
  const first = app.button(200, '101'); app.hover(first); app.flush();
  assert.equal(first.clicks, 1);
  app.leave(); app.enable(false);
  const over = app.listeners.pointerover;
  app.context.document.addEventListener = () => { throw new Error('Duplicate listener'); };
  vm.runInContext(source, app.context);
  assert.equal(app.listeners.pointerover, over);
  app.startup({ autoFollowX: true }); await Promise.resolve();
  const second = app.button(200, '102'); app.hover(second); app.flush();
  assert.equal(second.clicks, 1);
  app.leave(); app.hover(first); app.flush(); assert.equal(first.clicks, 1);
});

test('a stale reinjection read cannot undo a newer disabled setting', async () => {
  const app = setup();
  vm.runInContext(source, app.context);
  app.enable(false);
  app.startup({ autoFollowX: true }); await Promise.resolve();
  const button = app.button(); app.hover(button); app.flush();
  assert.equal(button.clicks, 0);
});
