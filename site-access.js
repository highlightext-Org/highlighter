'use strict';
(() => {
  const button = document.getElementById('grant-site-access');
  const status = document.getElementById('site-access-status');
  const origins = button.dataset.scope === 'x'
    ? ['https://x.com/*', 'https://twitter.com/*']
    : ['http://*/*', 'https://*/*'];
  async function update() {
    const granted = await chrome.permissions.contains({ origins });
    button.hidden = granted;
    status.textContent = granted ? 'Website access is enabled.' : 'Website access is needed. Click Allow website access and accept the browser prompt.';
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      // Request directly from the click: Firefox requires a user gesture, including for temporary add-ons.
      const granted = await chrome.permissions.request({ origins });
      button.hidden = granted;
      status.textContent = granted
        ? 'Website access enabled. Reload open web pages. Requeue any blocked accounts before starting again.'
        : 'Website access was not granted. Click Allow website access to try again.';
    } catch (error) { status.textContent = `Could not enable website access: ${error.message}`; }
    finally { button.disabled = false; }
  });
  update().catch(error => { status.textContent = `Could not check website access: ${error.message}`; });
})();
