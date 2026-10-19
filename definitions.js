(function (root) {
  'use strict';
  const color = value => /^#[a-f0-9]{6}$/i.test(value || '') ? value : '#fde047';
  function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); }
  function normalizeRule(input, defaults = {}) {
    if (typeof input === 'string') input = { text: input };
    if (!input || typeof input !== 'object') throw new Error('A rule must be an object or text.');
    const raw = { ...defaults, ...input };
    let text = String(raw.pattern ?? raw.text ?? '');
    let flags = String(raw.flags ?? '');
    // master.json uses match_mode; legacy keyword type can instead be a sentiment.
    const explicit = raw.ruleType ?? raw.matchType ?? raw.match_mode ?? (['regex', 'literal', 'keyword', 'text'].includes(raw.type) ? raw.type : undefined);
    const literal = /^\/([\s\S]*)\/([a-z]*)$/.exec(text);
    const type = explicit === 'regex' || (!explicit && (raw.regex === true || raw.pattern != null || literal)) ? 'regex' : 'literal';
    if (type === 'regex' && literal) { text = literal[1]; if (!flags) flags = literal[2]; }
    if (type === 'literal') text = text.trim();
    if (!text || text.length > 2048) throw new Error('Rules must contain 1–2,048 characters.');
    if (type === 'regex') {
      if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) throw new Error('Invalid or duplicate regex flags.');
      // Python-style source exports put global flags at the start of the pattern.
      // JavaScript needs these in RegExp's flags argument. Leave other modes to the engine’s syntax validation.
      let inline;
      while ((inline = /^\(\?([ims]+)\)/.exec(text))) {
        text = text.slice(inline[0].length);
        flags = [...new Set(flags + inline[1])].join('');
      }
      if (!text) throw new Error('A regex must contain a pattern after its flags.');
      // Syntax validation only. Execution always happens in a terminable worker.
      new RegExp(text, flags);
    } else flags = '';
    const category = String(raw.category || raw.group || raw.issue || raw.campaign || raw.location || raw.kind || 'keyword');
    return {
      id: String(raw.id || `${type}:${hash(`${category}\0${raw.group || raw.issue || raw.campaign || raw.location || category}\0${raw.kind || 'keyword'}\0${text}\0${flags}\0${raw.caseSensitive || false}`)}`),
      type, text, flags, kind: String(raw.kind || 'keyword'), category,
      group: String(raw.group || raw.issue || raw.campaign || raw.location || category),
      color: color(raw.color), enabled: raw.enabled !== false && raw.enabled !== 'false',
      caseSensitive: raw.caseSensitive === true || raw.caseSensitive === 'true',
      wholeWords: raw.wholeWords == null || raw.wholeWords === '' ? null : raw.wholeWords === true || raw.wholeWords === 'true'
    };
  }
  function extractRules(data) {
    if (!data || (data.schema_version != null && ![1, 2].includes(data.schema_version))) throw new Error('Unsupported definitions schema.');
    if (!['keywords', 'patterns', 'rules', 'profiles', 'groups'].some(key => Array.isArray(data[key]))) throw new Error('Expected keywords, patterns, rules, profiles, or groups.');
    const rules = [], errors = [];
    const add = (rule, defaults) => {
      try { rules.push(normalizeRule(rule, defaults)); }
      catch (error) { errors.push(`${rule?.id || rule?.text || rule?.pattern || 'Rule'}: ${error.message}`); }
    };
    const profiles = new Map();
    for (const setting of data.settings || []) for (const profile of setting.raw?.profiles || []) profiles.set(profile.id, profile);
    for (const entry of data.keywords || []) {
      if (entry.variants?.length) for (const variant of entry.variants) {
        const profile = profiles.get(variant.profile_id);
        const rule = { ...entry, ...variant.keyword };
        // Legacy positive/negative is a sentiment, not a matching type.
        if (profile?.enabled === false) rule.enabled = false;
        add(rule, { group: profile?.name || variant.profile_name || 'Keywords' });
      } else add(entry);
    }
    for (const rule of data.patterns || []) add(rule, { ruleType: 'regex' });
    for (const rule of data.rules || []) add(rule);
    for (const group of data.groups || []) {
      const defaults = { group: group.name || group.id, category: group.category || group.name || group.id };
      for (const rule of [...(group.rules || []), ...(group.keywords || [])]) add(typeof rule === 'string' ? { text: rule, enabled: group.enabled !== false } : { ...rule, enabled: group.enabled === false ? false : rule.enabled }, defaults);
      for (const rule of group.patterns || []) add(typeof rule === 'string' ? { pattern: rule, enabled: group.enabled !== false } : { ...rule, enabled: group.enabled === false ? false : rule.enabled }, { ...defaults, ruleType: 'regex' });
    }
    for (const profile of data.profiles || []) {
      const enabled = profiles.get(profile.id)?.enabled !== false;
      for (const handle of new Set([profile.x_handle, ...(profile.x_handles || [])])) if (handle) {
        add({ text: handle, kind: 'handle', category: 'Handles', color: '#a5b4fc', enabled });
        add({ text: `@${handle}`, kind: 'handle', category: 'Handles', color: '#a5b4fc', enabled });
      }
      for (const text of profile.wallets || []) add({ text, kind: 'wallet', category: 'Wallets', color: '#86efac', caseSensitive: true, enabled });
      for (const text of new Set([profile.x_url, ...(profile.profile_urls || [])])) if (text) add({ text, kind: 'url', category: 'Profile URLs', color: '#f9a8d4', enabled });
    }
    return { rules: deduplicate(rules, true), errors };
  }
  function signature(rule) {
    const insensitive = rule.type === 'regex' ? rule.flags.includes('i') || (!rule.caseSensitive && !rule.flags) : !rule.caseSensitive;
    const flags = rule.type === 'regex' ? [...new Set((rule.flags.replace(/[gi]/g, '') + (rule.caseSensitive ? '' : 'i')).split(''))].sort().join('') : '';
    return JSON.stringify([rule.type, insensitive && rule.type === 'literal' ? rule.text.toLowerCase() : rule.text, flags, rule.caseSensitive, rule.wholeWords, rule.kind]);
  }
  function deduplicate(rules, grouped = false) {
    const map = new Map();
    for (const rule of rules) {
      const key = signature(rule) + (grouped ? JSON.stringify([rule.group, rule.category]) : ''), previous = map.get(key);
      if (!previous || (rule.priority || 0) > (previous.priority || 0) || ((rule.priority || 0) === (previous.priority || 0) && !previous.enabled && rule.enabled)) map.set(key, rule);
    }
    return [...map.values()];
  }
  function resolveRules(remote, local = [], project = {}) {
    const map = new Map();
    const apply = (rules, source, priority) => { for (const raw of rules) {
      const previous = map.get(raw.id);
      const rule = normalizeRule({ ...previous, ...raw });
      map.set(rule.id, { ...rule, source, priority });
    } };
    apply(remote, 'remote', 0); apply(local, 'local', 1); apply(project.rules || [], 'project', 2);
    // A project override references the original rule ID and survives remote refreshes.
    for (const [id, override] of Object.entries(project.overrides || {})) if (map.has(id)) apply([{ ...override, id }], 'project', 3);
    return deduplicate([...map.values()].filter(rule => !(project.disabledGroups || []).includes(rule.group))).filter(rule => rule.enabled);
  }
  const columns = ['id', 'type', 'text', 'flags', 'kind', 'category', 'group', 'color', 'enabled', 'caseSensitive', 'wholeWords'];
  function exportCSV(rules) {
    const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [columns, ...rules.map(rule => columns.map(key => rule[key]))].map(row => row.map(cell).join(',')).join('\r\n');
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || !cell) quoted = !quoted; else throw new Error('Unexpected quote in CSV.'); }
      else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (quoted) throw new Error('Unclosed CSV quote.');
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const header = rows.shift() || [];
    if (!header.includes('text') && !header.includes('pattern')) throw new Error('CSV needs a text or pattern column.');
    return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])));
  }
  function importRules(text, format) {
    const data = format === 'csv' ? { rules: parseCSV(text) } : JSON.parse(text);
    const result = extractRules(Array.isArray(data) ? { rules: data } : data);
    if (result.errors.length) throw new Error(result.errors.slice(0, 10).join('\n'));
    return result.rules;
  }
  // Stream the top-level JSON object, parsing array entries individually and discarding
  // unrelated datasets (holdings, source observations) instead of retaining the full file.
  async function readDefinitions(response, maxBytes = 32 * 1024 * 1024) {
    if (!response.body?.getReader) return response.json();
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const keep = new Set(['keywords', 'patterns', 'rules', 'profiles', 'settings', 'groups']);
    const result = {}; let state = 'root', key = '', token = '', depth = 0, quoted = false, escaped = false, array = false, bytes = 0, capture = false;
    function feed(c) {
      if (state === 'done') { if (!/\s/.test(c)) throw new Error('Unexpected data after JSON.'); return; }
      if (state === 'root') { if (/\s/.test(c)) return; if (c !== '{') throw new Error('Definitions must be a JSON object.'); state = 'key'; return; }
      if (state === 'key') {
        if (!token && /\s/.test(c)) return;
        if (!token && c === '}') { state = 'done'; return; }
        if (!token && c !== '"') throw new Error('Invalid JSON property.');
        token += c;
        if (token.length === 1) { quoted = true; return; }
        if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') { key = JSON.parse(token); token = ''; quoted = false; state = 'colon'; }
        return;
      }
      if (state === 'colon') { if (/\s/.test(c)) return; if (c !== ':') throw new Error('Expected colon.'); state = 'value'; return; }
      if (state === 'value') {
        if (/\s/.test(c)) return;
        capture = keep.has(key) || key === 'schema_version';
        array = c === '[';
        if (array) { if (capture) result[key] = []; state = 'array'; return; }
        state = 'token'; depth = 0;
      }
      if (state === 'array' && !token && /\s/.test(c)) return;
      if (state === 'array' && !token && c === ']') { state = 'separator'; return; }
      if (!quoted && depth === 0 && (c === ',' || c === ']' || c === '}') && token) {
        if (capture) {
          const value = JSON.parse(token);
          if (array) result[key].push(value); else result[key] = value;
        }
        token = '';
        if (array && c === ',') { state = 'array'; return; }
        if (array && c !== ']') throw new Error('Invalid array.');
        if (array) { state = 'separator'; return; }
        state = c === '}' ? 'done' : 'key'; return;
      }
      if (state === 'separator') { if (/\s/.test(c)) return; if (c === ',') state = 'key'; else if (c === '}') state = 'done'; else throw new Error('Expected comma.'); return; }
      // Keep only a small sentinel for discarded values; still track nesting and strings.
      if (capture) token += c; else token = 'discard';
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      if (depth < 0) throw new Error('Invalid JSON nesting.');
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error('Definitions exceed the 32 MiB download limit.');
        for (const c of decoder.decode(value, { stream: true })) feed(c);
      }
      for (const c of decoder.decode()) feed(c);
      if (state !== 'done') throw new Error('Incomplete definitions JSON.');
      return result;
    } finally { await reader.cancel().catch(() => {}); }
  }
  const api = { normalizeRule, extractRules, resolveRules, deduplicate, exportCSV, importRules, parseCSV, readDefinitions };
  root.HighlightextRules = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
