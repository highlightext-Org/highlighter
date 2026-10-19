(() => {
  'use strict';
  if (globalThis.__highlightextInstalled) return;
  globalThis.__highlightextInstalled = true;
  const prefix = 'hext-plugin-';
  const excluded = 'script,style,noscript,textarea,input,select,option,[hidden],[aria-hidden="true"],[data-hext-ui]';
  const blockTags = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'PRE', 'BLOCKQUOTE', 'BUTTON', 'BODY']);
  let matcher, observer, timer, style;
  const owned = new Set();
  function removeHighlights() {
    for (const name of owned) CSS.highlights.delete(name);
    owned.clear();
    style?.remove();
    style = null;
  }
  function scan() {
    observer?.disconnect();
    removeHighlights();
    const runs = [];
    let previousBlock;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && !node.parentElement?.closest(excluded) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let block = node.parentElement;
      while (block.parentElement && !blockTags.has(block.tagName)) block = block.parentElement;
      if (block !== previousBlock) runs.push([]);
      runs.at(-1).push(node);
      previousBlock = block;
    }
    // CSS ranges preserve the page DOM, including links and editable content.
    const groups = new Map();
    let count = 0;
    // Contiguous block runs allow phrases across inline formatting without
    // joining unrelated paragraphs or jumping across nested blocks.
    for (const run of runs) {
      const offsets = [];
      let text = '';
      for (const node of run) { offsets.push({ node, start: text.length, end: text.length + node.length }); text += node.nodeValue; }
      for (const item of matcher(text, 5000 - count)) {
        const first = offsets.find(part => part.end > item.start);
        const last = offsets.find(part => part.end >= item.end);
        const range = new Range();
        range.setStart(first.node, item.start - first.start);
        range.setEnd(last.node, item.end - last.start);
        const color = /^#[a-f0-9]{6}$/i.test(item.term.color) ? item.term.color : '#fde047';
        if (!groups.has(color)) groups.set(color, []);
        groups.get(color).push(range);
        count++;
      }
      if (count >= 5000) break;
    }
    style = document.createElement('style');
    style.dataset.hextUi = '';
    let rules = '';
    for (const [color, ranges] of groups) {
      const name = prefix + color.slice(1);
      CSS.highlights.set(name, new Highlight(...ranges));
      owned.add(name);
      rules += `::highlight(${name}){background-color:${color};color:#172018;}`;
    }
    style.textContent = rules;
    (document.head || document.documentElement).append(style);
    observer?.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    return { count, capped: count >= 5000 };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'hext:clear') {
      clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      removeHighlights();
      respond({ ok: true });
    }
    if (message.type !== 'hext:highlight') return;
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') {
      respond({ error: 'This browser does not support text highlights. Use a current version of Chrome or Edge.' });
      return;
    }
    try {
      clearTimeout(timer);
      observer?.disconnect();
      matcher = Highlightext.createMatcher(message.terms, message.options);
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(scan, 200);
      });
      respond(scan());
    } catch (error) { respond({ error: error.message }); }
  });
})();
