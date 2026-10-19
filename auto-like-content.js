(() => {
  'use strict';
  if (globalThis.__highlightextAutoLikeInstalled) {
    // Re-injection restores saved settings without adding duplicate listeners.
    if (typeof globalThis.__highlightextAutoLikeInstalled === 'function') globalThis.__highlightextAutoLikeInstalled();
    return;
  }
  // Keep site selectors and post identity separate for future platform adapters.
  const platforms = {
    'x.com': {
      selector: 'article[data-testid="tweet"] button[data-testid="like"]',
      key(button) {
        const article = button.closest('article[data-testid="tweet"]');
        const link = article?.querySelector('a[href*="/status/"] time')?.closest('a');
        return link?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1];
      }
    }
  };
  platforms['twitter.com'] = platforms['x.com'];
  const platform = platforms[location.hostname];
  if (!platform) return;
  globalThis.__highlightextAutoLikeInstalled = syncConfig;
  const attempted = new WeakSet(), posts = new Set();
  let enabled = false, frame = null, hovered = null, version = 0;
  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; hovered = null;
  }
  function update(config) {
    version++;
    enabled = config?.autoLikeX === true;
    if (!enabled) cancel();
  }
  function clickHovered() {
    frame = null;
    const button = hovered;
    if (!enabled || !button || !button.isConnected || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const key = platform.key(button);
    if (!button.matches(platform.selector) || attempted.has(button) || (key && posts.has(key)) || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-pressed') === 'true') return;
    if (button.closest('[hidden],[aria-hidden="true"],[inert]')) return;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return;
    const style = getComputedStyle(button);
    if (style.visibility !== 'visible' || Number(style.opacity) === 0 || style.pointerEvents === 'none') return;
    attempted.add(button);
    if (key) posts.add(key);
    button.click();
  }
  function over(event) {
    if (!enabled || !event.isTrusted || event.pointerType !== 'mouse' || event.buttons) return;
    const button = event.target.closest?.(platform.selector);
    if (!button || button === hovered) return;
    cancel();
    hovered = button;
    frame = requestAnimationFrame(clickHovered);
  }
  function out(event) {
    if (hovered && !hovered.contains(event.relatedTarget)) cancel();
  }
  document.addEventListener('pointerover', over, { passive: true });
  document.addEventListener('pointerout', out, { passive: true });
  document.addEventListener('pointerdown', cancel, { passive: true });
  document.addEventListener('pointerleave', cancel, { passive: true });
  document.addEventListener('visibilitychange', cancel);
  addEventListener('blur', cancel);
  addEventListener('scroll', cancel, { passive: true, capture: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) update(changes.config.newValue);
  });
  function syncConfig() {
    const initialVersion = version;
    return chrome.storage.local.get('config').then(({ config }) => {
      if (version === initialVersion) update(config);
    }).catch(() => {});
  }
  syncConfig();
})();
