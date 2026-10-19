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
// Self-contained because scripting.executeScript serializes the function.
async function checkXRequirements(expectedHandle, requirements) {
  const blocked = detail => ({ status: 'blocked', detail });
  const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const profilePath = `/${expectedHandle.toLowerCase()}`;
  const onProfile = () => ['x.com', 'twitter.com'].includes(location.hostname) && location.pathname.replace(/\/$/, '').toLowerCase() === profilePath;
  if (!onProfile()) return blocked('Profile changed before the location check.');
  let main = document.querySelector('[data-testid="primaryColumn"]');
  if (!main || document.querySelector('[role="dialog"]') || !main.querySelector('[data-testid="UserName"]')) return blocked('Profile unavailable for the location check.');
  const aboutLink = [...main.querySelectorAll('a[href]')].find(link => {
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && url.pathname.replace(/\/$/, '').toLowerCase() === `${profilePath}/about`;
  });
  if (!aboutLink) return blocked('About this account link unavailable. Check this profile manually.');
  aboutLink.click();
  const labels = { basedIn: 'Account based in', connectedVia: 'Connected via' };
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (!['x.com', 'twitter.com'].includes(location.hostname) || ![profilePath, `${profilePath}/about`].includes(location.pathname.replace(/\/$/, '').toLowerCase()) || document.querySelector('[role="dialog"]')) return blocked('Unexpected page during the location check.');
    if (location.pathname.replace(/\/$/, '').toLowerCase() !== `${profilePath}/about`) continue;
    main = document.querySelector('[data-testid="primaryColumn"]');
    if (!main || ![...main.querySelectorAll('h1, h2, [role="heading"]')].some(node => normalize(node.innerText || '') === 'about this account')) continue;
    const observed = {};
    for (const [key, label] of Object.entries(labels)) {
      if (!requirements[key]) continue;
      // Read only the value in the labeled row, never a bio, post, or unrelated page text.
      const node = [...main.querySelectorAll('span')].find(node => normalize(node.innerText || '') === normalize(label));
      let row = node?.parentElement;
      for (let depth = 0; row && depth < 3; depth++, row = row.parentElement) {
        const lines = (row.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
        const index = lines.findIndex(line => normalize(line) === normalize(label));
        const value = lines[index + 1];
        if (index >= 0 && value && value.length <= 100 && !Object.values(labels).some(other => normalize(other) === normalize(value))) {
          observed[key] = value;
          break;
        }
      }
    }
    if (Object.keys(labels).filter(key => requirements[key]).every(key => observed[key])) {
      const summary = Object.entries(observed).map(([key, value]) => `${labels[key]}: ${value}`).join('; ');
      const matches = Object.keys(labels).every(key => !requirements[key] || normalize(observed[key]) === normalize(requirements[key]));
      return { status: matches ? 'matched' : 'skipped', detail: `${matches ? 'Requirements matched' : 'Requirements not met'} · ${summary}` };
    }
  }
  return blocked('Required About this account details unavailable or unreadable. No follow attempted.');
}
if (typeof module !== 'undefined') module.exports = { followXProfile, checkXRequirements };
