// Executed only in the dedicated X profile tab by the queue manager.
async function followXProfile(expectedHandle) {
  if (!['x.com', 'twitter.com'].includes(location.hostname) || location.pathname.replace(/^\//, '').replace(/\/$/, '').toLowerCase() !== expectedHandle.toLowerCase()) return { status: 'blocked', detail: 'Profile changed. Review this account manually.' };
  const main = document.querySelector('[data-testid="primaryColumn"]');
  if (!main || document.querySelector('[role="dialog"]') || !main.querySelector('[data-testid="UserName"]')) return { status: 'blocked', detail: 'Profile unavailable, login required, or a dialog needs attention.' };
  // Limit matching to the profile header, never recommended users or posts.
  const actions = main.querySelector('[data-testid="placementTracking"]')?.parentElement;
  const buttons = actions ? [...actions.querySelectorAll('button[data-testid]')] : [];
  if (buttons.some(button => /-unfollow$/.test(button.dataset.testid))) return { status: 'already-following', detail: 'Already following.' };
  if (buttons.some(button => /-cancel$/.test(button.dataset.testid))) return { status: 'requested', detail: 'Follow request already pending.' };
  const button = buttons.find(button => /-follow$/.test(button.dataset.testid));
  if (!button || button.disabled) return { status: 'blocked', detail: 'Profile Follow button not available. Review manually.' };
  const id = button.dataset.testid.replace(/-follow$/, '');
  button.click();
  // A click alone is inconclusive; confirm the resulting state for this account's button.
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (document.querySelector('[role="dialog"]')) break;
    if (actions.querySelector(`[data-testid="${id}-unfollow"]`)) return { status: 'followed', detail: 'Following confirmed on X.' };
    if (actions.querySelector(`[data-testid="${id}-cancel"]`)) return { status: 'requested', detail: 'Follow request sent.' };
  }
  return { status: 'blocked', detail: 'X did not confirm the follow. Check the profile before retrying.' };
}
if (typeof module !== 'undefined') module.exports = { followXProfile };
