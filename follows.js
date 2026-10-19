/* Shared handle-list validation. No platform credentials are stored. */
(function (root) {
  'use strict';
  const PLATFORMS = {
    x: { name: 'X', base: 'https://x.com/', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], pattern: /^[A-Za-z0-9_]{1,15}$/, reserved: ['home', 'explore', 'notifications', 'messages', 'settings', 'search', 'i', 'intent', 'compose'] },
    facebook: { name: 'Facebook', base: 'https://www.facebook.com/', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'], pattern: /^[A-Za-z0-9.]{1,100}$/, reserved: ['home.php', 'profile.php', 'groups', 'watch', 'reel', 'reels', 'stories', 'marketplace', 'pages', 'photo.php', 'share', 'login', 'settings'] },
    instagram: { name: 'Instagram', base: 'https://www.instagram.com/', hosts: ['instagram.com', 'www.instagram.com'], pattern: /^[A-Za-z0-9._]{1,30}$/, reserved: ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'] },
    tiktok: { name: 'TikTok', base: 'https://www.tiktok.com/@', hosts: ['tiktok.com', 'www.tiktok.com'], pattern: /^[A-Za-z0-9._]{1,24}$/, reserved: [] }
  };
  function profile(value, defaultPlatform = 'x') {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid handle.');
    let platform = defaultPlatform, handle = value.trim();
    const prefix = handle.match(/^(x|facebook|fb|instagram|insta|tiktok):\s*/i);
    if (prefix) { platform = ({ fb: 'facebook', insta: 'instagram' })[prefix[1].toLowerCase()] || prefix[1].toLowerCase(); handle = handle.slice(prefix[0].length); }
    if (/^(https?:\/\/|(?:www\.)?(?:x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com)\/)/i.test(handle)) {
      const url = new URL(/^https?:/i.test(handle) ? handle : `https://${handle}`);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS profile URL.');
      // Match exact hosts so lookalike domains cannot become queued profile links.
      platform = Object.keys(PLATFORMS).find(key => PLATFORMS[key].hosts.includes(url.hostname));
      if (!platform) throw new Error('Unsupported profile website.');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1 || (platform === 'tiktok' && !parts[0].startsWith('@'))) throw new Error('Use a profile URL, not a post or page URL.');
      handle = parts[0];
    }
    const spec = PLATFORMS[platform];
    handle = handle.replace(/^@/, '');
    if (!spec || !spec.pattern.test(handle) || spec.reserved.includes(handle.toLowerCase()) || /^\.|\.$|\.\./.test(handle)) throw new Error('Invalid profile handle for this platform.');
    // One canonical key deduplicates handles imported with different casing or URL aliases.
    handle = handle.toLowerCase();
    return { key: `${platform}:${handle}`, platform, handle, url: spec.base + handle };
  }
  function parse(text, platform = 'x') {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('Paste at most 100,000 characters.');
    if (!Object.hasOwn(PLATFORMS, platform)) throw new Error('Select a supported platform.');
    const tokens = text.trim().split(/[\s,;]+/).filter(Boolean);
    if (tokens.length > 1000) throw new Error('Import at most 1,000 handles at a time.');
    const entries = [], errors = [], seen = new Set(); let duplicates = 0;
    for (const token of tokens) {
      try {
        const entry = profile(token, platform);
        if (seen.has(entry.key)) { duplicates++; continue; }
        seen.add(entry.key); entries.push(entry);
      } catch (error) { errors.push({ value: token.slice(0, 150), error: error.message }); }
    }
    return { entries, errors, duplicates };
  }
  function requirements(value = {}) {
    const result = {};
    for (const field of ['basedIn', 'connectedVia']) {
      const text = value[field] ?? '';
      if (typeof text !== 'string' || text.length > 100 || /[\r\n]/.test(text)) throw new Error('Use at most 100 characters for each follow requirement.');
      result[field] = text.trim().replace(/\s+/g, ' ');
    }
    return result;
  }
  const SPEEDS = {
    slow: { label: 'Slow', pauseMs: 60000, settleMs: 2500 },
    normal: { label: 'Normal', pauseMs: 30000, settleMs: 1500 },
    fast: { label: 'Fast', pauseMs: 10000, settleMs: 1000 }
  };
  function speed(value = 'normal') {
    if (!Object.hasOwn(SPEEDS, value)) throw new Error('Choose Slow, Normal, or Fast.');
    return value;
  }
  function listSource(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/(followers|following|verified_followers)\/?$/);
      if (!match) return null;
      return { owner: profile(match[1], 'x').handle, list: match[2], url: `https://x.com/${match[1].toLowerCase()}/${match[2]}` };
    } catch { return null; }
  }
  function collectHandles(document, sourceUrl) {
    if (!listSource(sourceUrl)) return [];
    const found = new Map();
    // User cells inside the primary column exclude navigation, posts, and sidebar suggestions.
    for (const cell of document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]')) {
      const rect = cell.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= document.documentElement.clientHeight || cell.closest('[hidden],[aria-hidden="true"]')) continue;
      for (const anchor of cell.querySelectorAll('a[href]')) {
        try {
          const url = new URL(anchor.getAttribute('href'), sourceUrl);
          if (!['x.com', 'twitter.com'].includes(url.hostname)) continue;
          const entry = profile(url.href, 'x');
          // Require the account's own displayed @handle, rather than handles mentioned in its bio.
          const labels = [anchor.textContent, ...Array.from(anchor.querySelectorAll('span'), span => span.textContent)];
          if (!labels.some(label => label?.trim().toLowerCase() === `@${entry.handle}`)) continue;
          found.set(entry.key, entry.handle);
          break;
        } catch { /* Ignore non-profile links. */ }
      }
      if (found.size >= 100) break;
    }
    return [...found.values()];
  }
  const api = { PLATFORMS, profile, parse, requirements, SPEEDS, speed, listSource, collectHandles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HighlightextFollows = api;
})(globalThis);
