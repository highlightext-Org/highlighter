(function (root) {
  'use strict';
  const MATCHES = ['https://x.com/*', 'https://twitter.com/*', 'https://www.instagram.com/*', 'https://instagram.com/*', 'https://www.tiktok.com/*', 'https://tiktok.com/*'];
  const MAX_RECORDS = 5000, MAX_BYTES = 4 * 1024 * 1024;
  function platform(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      return ({ 'x.com': 'X', 'twitter.com': 'X', 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok' })[parsed.hostname.replace(/^www\./, '')] || null;
    } catch { return null; }
  }
  function postURL(value, source) {
    try {
      const url = new URL(value, source);
      if (platform(url.href) !== platform(source)) return '';
      const match = platform(source) === 'X' ? url.pathname.match(/^\/[^/]+\/status\/\d+/) :
        platform(source) === 'Instagram' ? url.pathname.match(/^\/(?:p|reel|reels)\/[^/]+/) : url.pathname.match(/^\/@[^/]+\/video\/\d+/);
      return match ? url.origin + match[0] : '';
    } catch { return ''; }
  }
  function normalize(entry, sourceUrl, projectId, now) {
    if (!entry || typeof entry.text !== 'string') return null;
    const text = entry.text.trim().slice(0, 12000);
    if (!text) return null;
    const postUrl = postURL(entry.postUrl, sourceUrl);
    const author = typeof entry.author === 'string' ? entry.author.trim().slice(0, 300) : '';
    return { key: JSON.stringify([projectId, platform(sourceUrl), postUrl || author, postUrl ? '' : text]),
      projectId, platform: platform(sourceUrl), text, author, postUrl, sourceUrl: sourceUrl.slice(0, 2048),
      publishedAt: typeof entry.publishedAt === 'string' ? entry.publishedAt.slice(0, 100) : '', capturedAt: now };
  }
  function append(records, incoming) {
    const keys = new Set(records.map(record => record.key));
    const combined = records.slice();
    for (const record of incoming) if (record && !keys.has(record.key)) { keys.add(record.key); combined.push(record); }
    // Keep the latest records inside a separate storage budget from match history.
    let bytes = 2; const retained = [];
    for (let i = combined.length - 1; i >= 0 && retained.length < MAX_RECORDS; i--) {
      const size = JSON.stringify(combined[i]).length * 2 + 2;
      if (bytes + size > MAX_BYTES) break;
      retained.push(combined[i]); bytes += size;
    }
    return { records: retained.reverse(), dropped: combined.length - retained.length };
  }
  function collect(document, sourceUrl) {
    const site = platform(sourceUrl);
    if (!site) return [];
    const selector = site === 'X' ? 'article[data-testid="tweet"]' : site === 'Instagram' ? 'article' :
      '[data-e2e="recommend-list-item-container"], [data-e2e="recommend-list-item"], [data-e2e="browse-video"], article';
    const cards = new Set(document.querySelectorAll(selector));
    if (site === 'TikTok') for (const anchor of document.querySelectorAll('a[href*="/video/"]')) {
      if (![...cards].some(card => card.contains(anchor))) cards.add(anchor.closest('article') || anchor.parentElement?.parentElement);
    }
    const result = [];
    for (const card of cards) {
      if (!card || result.length >= 100) break;
      const rect = card.getBoundingClientRect();
      // Only capture posts rendered in the viewport, including partially visible cards.
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= document.documentElement.clientHeight || card.closest('[hidden],[aria-hidden="true"]')) continue;
      const linkSelector = site === 'X' ? 'a[href*="/status/"]' : site === 'Instagram' ? 'a[href*="/p/"],a[href*="/reel/"],a[href*="/reels/"]' : 'a[href*="/video/"]';
      const links = [...card.querySelectorAll(linkSelector)];
      const time = card.querySelector('time');
      const link = (site === 'X' && time?.closest('a')) || links[0];
      const textElement = site === 'X' ? card.querySelector('[data-testid="tweetText"]') : null;
      const text = (textElement?.innerText || card.innerText || '').trim().slice(0, 12000);
      const author = card.querySelector(site === 'X' ? '[data-testid="User-Name"]' : site === 'Instagram' ? 'header a' : '[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"], a[href^="/@"]')?.innerText || '';
      if (text) result.push({ text, author, postUrl: postURL(link?.href, sourceUrl), publishedAt: time?.getAttribute('datetime') || '' });
    }
    return result;
  }
  function csv(records) {
    const fields = ['platform', 'text', 'author', 'postUrl', 'sourceUrl', 'publishedAt', 'capturedAt', 'projectId'];
    const cell = value => {
      let text = String(value ?? '');
      // Post text is untrusted: prevent spreadsheet formula evaluation on export.
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    return [fields, ...records.map(record => fields.map(field => record[field]))].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { MATCHES, MAX_RECORDS, MAX_BYTES, platform, postURL, normalize, append, collect, csv };
  root.HighlightextTimeline = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
