'use strict';
const $ = id => document.getElementById(id);
let terms = [];
let match = () => [];
const options = { keyword: true, handle: true, wallet: true, url: true, wholeWords: true, caseSensitive: false };
let saveTimer;

function render() {
  const value = $('text').value;
  const matches = match(value);
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const item of matches) {
    fragment.append(document.createTextNode(value.slice(offset, item.start)));
    const mark = document.createElement('mark');
    mark.textContent = value.slice(item.start, item.end);
    mark.style.backgroundColor = item.term.color;
    fragment.append(mark);
    offset = item.end;
  }
  fragment.append(document.createTextNode(value.slice(offset) + '\n'));
  $('highlights').replaceChildren(fragment);
  $('count').textContent = `${matches.length === 5000 ? '5,000+' : matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  syncScroll();
}
function syncScroll() {
  $('highlights').style.width = `${$('text').clientWidth}px`;
  $('highlights').scrollTop = $('text').scrollTop;
  $('highlights').scrollLeft = $('text').scrollLeft;
}
function rebuild() { match = Highlightext.createMatcher(terms, options); render(); }

async function load(force = false) {
  $('refresh').disabled = true;
  $('status').textContent = 'Downloading word list…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'loadTerms', force });
    if (result.terms?.length) {
      terms = result.terms;
      $('highlight-page').disabled = false;
      rebuild();
      $('status').textContent = `${terms.length.toLocaleString()} terms · Updated ${new Date(result.updatedAt).toLocaleString()}${result.ok ? '' : ' · Offline: using saved list'}`;
      $('status').title = result.error || '';
    } else throw new Error(result.error || 'No terms loaded.');
  } catch (error) { $('status').textContent = `${error.message} Click refresh to retry.`; }
  finally { $('refresh').disabled = false; }
}

async function pageAction(clear) {
  $('page-status').textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open a regular web page first. Browser settings and store pages cannot be highlighted.');
    if (clear) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'hext:clear' }); }
      catch { /* A page without an injected highlighter is already clear. */ }
      $('page-status').textContent = 'Page highlights cleared.';
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['matcher.js', 'content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'hext:highlight', terms, options });
    if (result.error) throw new Error(result.error);
    $('page-status').textContent = `${result.count.toLocaleString()}${result.capped ? '+' : ''} matches highlighted. Live updates are on for this page.`;
  } catch (error) { $('page-status').textContent = error.message; }
}

$('text').addEventListener('input', () => {
  render();
  clearTimeout(saveTimer);
  // Session storage keeps the draft across popup opens without writing it to disk.
  saveTimer = setTimeout(() => chrome.storage.session.set({ draft: $('text').value }), 150);
});
$('text').addEventListener('scroll', syncScroll);
document.querySelectorAll('[data-option]').forEach(input => input.addEventListener('change', () => {
  options[input.dataset.option] = input.checked;
  chrome.storage.local.set({ options });
  rebuild();
}));
$('refresh').addEventListener('click', () => load(true));
$('highlight-page').addEventListener('click', () => pageAction(false));
$('clear-page').addEventListener('click', () => pageAction(true));
(async () => {
  const [saved, session] = await Promise.all([chrome.storage.local.get('options'), chrome.storage.session.get('draft')]);
  Object.assign(options, saved.options);
  document.querySelectorAll('[data-option]').forEach(input => { input.checked = options[input.dataset.option]; });
  $('text').value = session.draft || '';
  await load();
})();
