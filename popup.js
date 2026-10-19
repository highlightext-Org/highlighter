'use strict';
const $ = id => document.getElementById(id);
let state, renderTimer, saveTimer, renderGeneration = 0;
const options = { keyword: true, handle: true, wallet: true, url: true, wholeWords: true, caseSensitive: false };
async function request(message) { const result = await chrome.runtime.sendMessage(message); if (result.error && result.ok !== false) throw new Error(result.error); return result; }
function project() { return state.config.projects[state.config.activeProject]; }
function syncScroll() { $('highlights').style.width = `${$('text').clientWidth}px`; $('highlights').scrollTop = $('text').scrollTop; $('highlights').scrollLeft = $('text').scrollLeft; }
async function render() {
  if (!state) return;
  const token = ++renderGeneration, value = $('text').value.slice(0, 20000);
  try {
    const result = await request({ type: 'scan', projectId: state.config.activeProject, texts: [value] });
    if (token !== renderGeneration) return;
    const fragment = document.createDocumentFragment(); let offset = 0;
    for (const item of result.results[0]) {
      fragment.append(document.createTextNode(value.slice(offset, item.start)));
      const mark = document.createElement('mark'); mark.textContent = value.slice(item.start, item.end); mark.style.backgroundColor = item.term.color;
      fragment.append(mark); offset = item.end;
    }
    fragment.append(document.createTextNode(value.slice(offset) + '\n')); $('highlights').replaceChildren(fragment);
    $('count').textContent = `${result.results[0].length}${result.capped ? '+' : ''} matches`; syncScroll();
  } catch (error) { if (token === renderGeneration) { $('highlights').replaceChildren(); $('count').textContent = 'Scan stopped'; $('page-status').textContent = error.message; } }
}
async function load(force = false) {
  $('refresh').disabled = true;
  try {
    state = await request({ type: 'loadTerms', force });
    $('project').replaceChildren(...Object.entries(state.config.projects).map(([id, item]) => { const option = document.createElement('option'); option.value = id; option.textContent = item.name; return option; }));
    $('project').value = state.config.activeProject;
    Object.assign(options, { keyword: true, handle: true, wallet: true, url: true, wholeWords: true, caseSensitive: false }, project().options);
    document.querySelectorAll('[data-option]').forEach(input => { input.checked = options[input.dataset.option]; });
    $('highlight-page').disabled = false;
    $('status').textContent = `${state.terms.length.toLocaleString()} active rules · Last sync: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'never'}${state.syncError ? ` · Download error: ${state.syncError}` : ''}${state.definitionErrors?.length ? ` · ${state.definitionErrors.length} invalid source rules skipped` : ''}`;
    await render();
  } catch (error) { $('status').textContent = error.message; }
  finally { $('refresh').disabled = false; }
}
async function saveOptions() { project().options = { ...options }; await request({ type: 'saveConfig', config: state.config }); await render(); }
async function pageAction(clear) {
  $('page-status').textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open a regular web page first.');
    if (clear) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'hext:clear' }); } catch { /* Already clear. */ }
      $('page-status').textContent = 'Page highlights cleared.'; return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'hext:highlight', projectId: state.config.activeProject });
    if (result.error) throw new Error(result.error);
    $('page-status').textContent = `${result.count.toLocaleString()} matches · Live updates on${result.capped ? ' · scan limit reached' : ''}.`;
  } catch (error) { $('page-status').textContent = error.message; }
}
$('text').maxLength = 20000;
$('text').addEventListener('input', () => {
  clearTimeout(renderTimer); renderGeneration++; renderTimer = setTimeout(render, 250);
  clearTimeout(saveTimer); saveTimer = setTimeout(() => chrome.storage.session.set({ draft: $('text').value }), 150);
});
$('text').addEventListener('scroll', syncScroll);
document.querySelectorAll('[data-option]').forEach(input => input.addEventListener('change', () => { options[input.dataset.option] = input.checked; saveOptions().catch(error => { $('page-status').textContent = error.message; }); }));
$('project').addEventListener('change', async () => {
  try { state.config.activeProject = $('project').value; await request({ type: 'saveConfig', config: state.config }); await load(); }
  catch (error) { $('page-status').textContent = error.message; }
});
$('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refresh').addEventListener('click', () => load(true));
$('highlight-page').addEventListener('click', () => pageAction(false));
$('clear-page').addEventListener('click', () => pageAction(true));
(async () => { const { draft = '' } = await chrome.storage.session.get('draft'); $('text').value = draft; await load(); })();
