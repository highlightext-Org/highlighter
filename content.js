(() => {
  'use strict';
  if (globalThis.__highlightextInstalled) return;
  globalThis.__highlightextInstalled = true;
  const prefix = 'hext-plugin-';
  const excluded = 'script,style,noscript,textarea,input,select,option,[hidden],[aria-hidden="true"],[data-hext-ui]';
  const blocks = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'PRE', 'BLOCKQUOTE', 'BUTTON', 'BODY']);
  let observer, timer, style, badge, projectId, generation = 0, running = false, dirty = false;
  const owned = new Set();
  function removeHighlights() {
    for (const name of owned) globalThis.CSS?.highlights?.delete(name);
    owned.clear(); style?.remove(); style = null;
  }
  function status(text) {
    if (!badge) {
      badge = document.createElement('div'); badge.dataset.hextUi = '';
      badge.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#20362a;color:white;padding:8px 12px;border-radius:8px;font:12px system-ui;max-width:340px';
      badge.setAttribute('role', 'status');
      (document.body || document.documentElement).append(badge);
    }
    badge.textContent = `Highlightext · ${text}`;
  }
  function schedule() {
    dirty = true;
    if (!timer && !running) timer = setTimeout(() => { timer = null; scan().catch(error => status(error.message)); }, 1000);
  }
  async function scan() {
    if (running) { schedule(); return { count: 0, queued: true }; }
    running = true; dirty = false;
    const token = generation;
    try {
      const runs = []; let previousBlock, characters = 0, examined = 0, truncated = false;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (++examined > 20000) return NodeFilter.FILTER_ACCEPT;
          return node.nodeValue && !node.parentElement?.closest(excluded) && node.parentElement?.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (examined > 20000 || characters >= 200000 || runs.length >= 2000) { truncated = true; break; }
        let block = node.parentElement;
        while (block.parentElement && !blocks.has(block.tagName)) block = block.parentElement;
        const length = Math.min(node.length, 200000 - characters, 20000);
        if (length < node.length) truncated = true;
        if (block !== previousBlock || !runs.length || runs.at(-1).text.length + length > 20000) runs.push({ text: '', offsets: [] });
        const run = runs.at(-1);
        run.offsets.push({ node, start: run.text.length, end: run.text.length + length });
        run.text += node.nodeValue.slice(0, length); characters += length; previousBlock = block;
      }
      const result = await chrome.runtime.sendMessage({ type: 'scan', projectId, texts: runs.map(run => run.text) });
      if (token !== generation) return { count: 0, cancelled: true };
      if (result.error) throw new Error(result.error);
      removeHighlights();
      const groups = new Map(); let count = 0;
      result.results.forEach((matches, index) => {
        const run = runs[index];
        for (const item of matches) {
          const first = run.offsets.find(part => part.end > item.start), last = run.offsets.find(part => part.end >= item.end);
          if (!first?.node.isConnected || !last?.node.isConnected || item.start - first.start > first.node.length || item.end - last.start > last.node.length) { dirty = true; continue; }
          const range = new Range(); range.setStart(first.node, item.start - first.start); range.setEnd(last.node, item.end - last.start);
          const color = /^#[a-f0-9]{6}$/i.test(item.term.color) ? item.term.color : '#fde047';
          if (!groups.has(color)) groups.set(color, []);
          groups.get(color).push(range); count++;
        }
      });
      style = document.createElement('style'); style.dataset.hextUi = '';
      for (const [color, ranges] of groups) {
        const name = prefix + color.slice(1); CSS.highlights.set(name, new Highlight(...ranges)); owned.add(name);
        style.textContent += `::highlight(${name}){background-color:${color};color:#172018;}`;
      }
      (document.head || document.documentElement).append(style);
      status(`${count.toLocaleString()} matches${result.capped || truncated ? ' · scan limit reached' : ''}`);
      return { count, capped: result.capped || truncated };
    } finally { running = false; if (dirty && observer) schedule(); }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'hext:clear') {
      generation++; clearTimeout(timer); timer = null; dirty = false;
      observer?.disconnect(); observer = null; removeHighlights(); badge?.remove(); badge = null;
      respond({ ok: true }); return;
    }
    if (message.type !== 'hext:highlight') return;
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') { respond({ error: 'Use Chrome, Edge, or Firefox 140 or later for page highlighting.' }); return; }
    if (!document.body) { respond({ error: 'This page has no text body.' }); return; }
    generation++; projectId = message.projectId; observer?.disconnect();
    observer = new MutationObserver(changes => {
      if (changes.some(change => {
        const target = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        if (target?.closest('[data-hext-ui]')) return false;
        return change.type !== 'childList' || ![...change.addedNodes, ...change.removedNodes].every(node => node.nodeType === 1 && node.matches('[data-hext-ui]'));
      })) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    scan().then(respond, error => { status(error.message); respond({ error: error.message }); });
    return true;
  });
})();
