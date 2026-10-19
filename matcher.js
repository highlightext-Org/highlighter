(function (root) {
  'use strict';
  const DEFAULT_COLOR = '#fde047';
  const word = /[\p{L}\p{N}_]/u;
  const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_COLOR;

  function extractTerms(data) {
    if (data?.schema_version !== 1 || !Array.isArray(data.keywords) || !Array.isArray(data.profiles)) {
      throw new Error('Unsupported word list format. Expected master.json schema version 1.');
    }
    const terms = new Map();
    const add = (text, kind, tint = DEFAULT_COLOR, caseSensitive = false) => {
      if (typeof text !== 'string' || !text.trim()) return;
      text = text.trim();
      const key = `${kind}:${caseSensitive ? text : text.toLowerCase()}`;
      if (!terms.has(key)) terms.set(key, { text, kind, color: color(tint), caseSensitive });
    };
    const disabledProfiles = new Set();
    for (const settings of data.settings || []) {
      for (const profile of settings.raw?.profiles || []) {
        if (profile.enabled === false) disabledProfiles.add(profile.id);
      }
    }
    for (const entry of data.keywords) {
      if (!entry.variants?.length) { add(entry.text, 'keyword'); continue; }
      for (const variant of entry.variants) {
        if (variant.keyword?.enabled === false || disabledProfiles.has(variant.profile_id)) continue;
        add(variant.keyword?.text || entry.text, 'keyword', variant.keyword?.color);
      }
    }
    for (const profile of data.profiles) {
      for (const handle of new Set([profile.x_handle, ...(profile.x_handles || [])])) {
        if (handle) { add(handle, 'handle', '#a5b4fc'); add(`@${handle}`, 'handle', '#a5b4fc'); }
      }
      for (const wallet of profile.wallets || []) add(wallet, 'wallet', '#86efac', true);
      for (const url of [profile.x_url, ...(profile.profile_urls || [])]) add(url, 'url', '#f9a8d4');
    }
    return [...terms.values()];
  }

  function createLiteralMatcher(terms, options = {}) {
    const trie = { next: new Map(), terms: [] };
    for (const term of terms) {
      if (options[term.kind] === false) continue;
      let node = trie;
      // Locale-independent folding retains string offsets, including non-ASCII text.
      for (const char of term.text) {
        const key = char.toLowerCase();
        if (!node.next.has(key)) node.next.set(key, { next: new Map(), terms: [] });
        node = node.next.get(key);
      }
      node.terms.push(term);
    }
    return function match(text, limit = 5000) {
      const matches = [];
      let start = 0;
      while (start < text.length && matches.length < limit) {
        let node = trie;
        let best = null;
        for (let end = start; end < text.length;) {
          const char = String.fromCodePoint(text.codePointAt(end));
          node = node.next.get(char.toLowerCase());
          if (!node) break;
          end += char.length;
          for (const term of node.terms) {
            const previous = start > 0 ? Array.from(text.slice(Math.max(0, start - 2), start)).pop() : '';
            const following = end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '';
            const first = Array.from(term.text)[0];
            const last = Array.from(term.text).pop();
            if ((term.wholeWords ?? options.wholeWords) !== false &&
                ((word.test(first) || first === '@') && word.test(previous || '') ||
                 word.test(last) && word.test(following || ''))) continue;
            if ((term.caseSensitive || options.caseSensitive) && text.slice(start, end) !== term.text) continue;
            // Continuing down the trie makes the longest valid match win.
            if (!best || (term.priority || 0) > (best.term.priority || 0) || ((term.priority || 0) === (best.term.priority || 0) && end >= best.end)) best = { start, end, term };
          }
        }
        if (best) { matches.push(best); start = best.end; }
        else start += String.fromCodePoint(text.codePointAt(start)).length;
      }
      return matches;
    };
  }
  function createMatcher(terms, options = {}, progress = () => {}) {
    const enabled = terms.filter(term => term.enabled !== false && options[term.kind] !== false);
    const literals = createLiteralMatcher(enabled.filter(term => term.type !== 'regex'), options);
    const patterns = enabled.filter(term => term.type === 'regex');
    if (patterns.length > 200) throw new Error('Enable at most 200 regex rules per project.');
    return (text, limit = 5000) => {
      if (limit <= 0) return [];
      const matches = literals(text, limit);
      for (const term of patterns) {
        progress(term.id);
        let flags = term.flags || '';
        if (term.caseSensitive || options.caseSensitive) flags = flags.replace('i', '');
        else if (!flags.includes('i')) flags += 'i';
        if (!flags.includes('g')) flags += 'g';
        const regex = new RegExp(term.text, flags);
        let item, count = 0;
        while ((item = regex.exec(text)) && count < limit) {
          if (!item[0].length) {
            const char = text.codePointAt(regex.lastIndex);
            regex.lastIndex += (regex.unicode || regex.unicodeSets) && char > 0xffff ? 2 : 1;
            continue;
          }
          const start = item.index, end = start + item[0].length;
          const previous = Array.from(text.slice(Math.max(0, start - 2), start)).pop() || '';
          const following = end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '';
          if ((term.wholeWords ?? options.wholeWords) !== false && (word.test(String.fromCodePoint(item[0].codePointAt(0))) && word.test(previous) || word.test(Array.from(item[0]).pop()) && word.test(following))) continue;
          matches.push({ start, end, term }); count++;
        }
      }
      matches.sort((a, b) => a.start - b.start || (b.term.priority || 0) - (a.term.priority || 0) || b.end - a.end || (a.term.id || '').localeCompare(b.term.id || ''));
      const result = []; let end = -1;
      for (const item of matches) if (item.start >= end) { result.push(item); end = item.end; if (result.length >= limit) break; }
      return result;
    };
  }
  const api = { extractTerms, createMatcher };
  root.Highlightext = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
