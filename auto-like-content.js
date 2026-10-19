(() => {
  'use strict';
  if (globalThis.__highlightextAutoLikeInstalled) return;
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
  globalThis.__highlightextAutoLikeInstalled = true;
  const radius = 100, attempted = new WeakSet(), posts = new Set();
  let enabled = false, frame = null, pointer = null, version = 0;
  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; pointer = null;
  }
  function update(config) {
    version++;
    enabled = config?.autoLikeX === true;
    if (!enabled) cancel();
  }
  function clickNearest() {
    frame = null;
    if (!enabled || !pointer || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    let nearest, minimum = radius + 1;
    for (const button of document.querySelectorAll(platform.selector)) {
      const key = platform.key(button);
      if (attempted.has(button) || (key && posts.has(key)) || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.getAttribute('aria-pressed') === 'true') continue;
      if (button.closest('[hidden],[aria-hidden="true"],[inert]')) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue;
      const distance = Math.hypot(Math.max(rect.left - pointer.x, 0, pointer.x - rect.right), Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom));
      if (distance > radius || distance >= minimum) continue;
      const style = getComputedStyle(button);
      if (style.visibility !== 'visible' || Number(style.opacity) === 0 || style.pointerEvents === 'none') continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || !button.contains(hit)) continue;
      nearest = { button, key }; minimum = distance;
    }
    if (!nearest) return;
    attempted.add(nearest.button);
    if (nearest.key) posts.add(nearest.key);
    nearest.button.click();
  }
  function move(event) {
    if (!enabled || !event.isTrusted || event.pointerType !== 'mouse' || event.buttons) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (frame === null) frame = requestAnimationFrame(clickNearest);
  }
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', cancel, { passive: true });
  document.addEventListener('pointerleave', cancel, { passive: true });
  document.addEventListener('visibilitychange', cancel);
  addEventListener('blur', cancel);
  addEventListener('scroll', cancel, { passive: true, capture: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) update(changes.config.newValue);
  });
  const initialVersion = version;
  chrome.storage.local.get('config').then(({ config }) => {
    if (version === initialVersion) update(config);
  }).catch(() => {});
})();
