'use strict';
const $ = id => document.getElementById(id);
let state, page = 0, records = [];
const PAGE_SIZE = 50;
const project = () => state.config.projects[state.config.activeProject];
async function request(message) { const result = await chrome.runtime.sendMessage(message); if (result.error && result.ok !== false) throw new Error(result.error); return result; }
function notice(text = '') { $('notice').textContent = text; }
function action(fn) { return async event => { notice(); try { await fn(event); } catch (error) { notice(error.message); } }; }
async function save() {
  try { await request({ type: 'saveConfig', config: state.config }); }
  catch (error) { await reload(); throw error; }
  await reload();
}
function allRules() {
  const map = new Map();
  for (const [source, rules] of [['remote', state.remoteRules], ['local', state.config.localRules], ['project', project().rules]]) for (const rule of rules) map.set(rule.id, { ...map.get(rule.id), ...rule, source });
  for (const [id, changes] of Object.entries(project().overrides)) if (map.has(id)) map.set(id, { ...map.get(id), ...changes, source: 'project' });
  return [...map.values()];
}
function resetEditor() { $('rule-form').reset(); $('rule-id').value = ''; $('editor-title').textContent = 'Add or override a rule'; }
function edit(rule) {
  $('rule-id').value = rule.id; $('rule-type').value = rule.type; $('rule-text').value = rule.text; $('flags').value = rule.flags;
  $('kind').value = rule.kind; $('category').value = rule.category; $('group').value = rule.group; $('color').value = rule.color;
  $('enabled').checked = rule.enabled; $('sensitive').checked = rule.caseSensitive; $('boundaries').value = rule.wholeWords == null ? '' : String(rule.wholeWords);
  $('scope').value = rule.source === 'local' ? 'local' : 'project';
  $('editor-title').textContent = `Edit / override ${rule.id}`; $('rule-form').scrollIntoView({ behavior: 'smooth' });
}
function drawRules() {
  const query = $('search').value.toLowerCase();
  const rules = allRules().filter(rule => [rule.id, rule.text, rule.category, rule.group].some(value => value.toLowerCase().includes(query)));
  page = Math.max(0, Math.min(page, Math.ceil(rules.length / PAGE_SIZE) - 1));
  $('rules').replaceChildren();
  for (const rule of rules.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const row = document.createElement('tr');
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled; enabled.setAttribute('aria-label', `Enable ${rule.id}`);
    enabled.addEventListener('change', action(async () => { project().overrides[rule.id] = { ...project().overrides[rule.id], enabled: enabled.checked }; await save(); }));
    const cells = Array.from({ length: 6 }, () => document.createElement('td')); cells[0].append(enabled);
    const code = document.createElement('code'); code.textContent = rule.text; const id = document.createElement('span'); id.className = 'muted'; id.textContent = rule.id; cells[1].append(code, id);
    cells[2].textContent = `${rule.type}${rule.flags ? ` / ${rule.flags}` : ''}`;
    cells[3].textContent = `${rule.category} / ${rule.group}${project().disabledGroups.includes(rule.group) ? ' (group disabled)' : ''}`;
    cells[4].textContent = rule.source;
    const editButton = document.createElement('button'); editButton.textContent = 'Edit'; editButton.addEventListener('click', () => edit(rule)); cells[5].append(editButton);
    if (rule.source !== 'remote') {
      const remove = document.createElement('button'); remove.className = 'quiet'; remove.textContent = 'Remove override / rule';
      remove.addEventListener('click', action(async () => {
        delete project().overrides[rule.id]; project().rules = project().rules.filter(item => item.id !== rule.id);
        if (rule.source === 'local') state.config.localRules = state.config.localRules.filter(item => item.id !== rule.id);
        await save();
      })); cells[5].append(remove);
    }
    row.append(...cells); $('rules').append(row);
  }
  $('rule-count').textContent = `${rules.length.toLocaleString()} definitions · ${state.terms.length.toLocaleString()} active after priority, groups, and deduplication`;
  $('page').textContent = `${page + 1} / ${Math.max(1, Math.ceil(rules.length / PAGE_SIZE))}`;
  $('previous').disabled = page === 0; $('next').disabled = (page + 1) * PAGE_SIZE >= rules.length;
}
function drawGroups() {
  $('groups').replaceChildren();
  for (const group of [...new Set(allRules().map(rule => rule.group))].sort()) {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = !project().disabledGroups.includes(group);
    input.addEventListener('change', action(async () => { project().disabledGroups = project().disabledGroups.filter(item => item !== group); if (!input.checked) project().disabledGroups.push(group); await save(); }));
    label.append(input, document.createTextNode(group)); $('groups').append(label);
  }
}
async function drawRecords() {
  ({ records } = await request({ type: 'getRecords', projectId: state.config.activeProject }));
  $('record-count').textContent = `${records.length.toLocaleString()} saved in this project`; $('records').replaceChildren();
  for (const record of records.slice(-50).reverse()) {
    const row = document.createElement('tr');
    for (const value of [record.matchedText, `${record.ruleId} / ${record.category}`, `${record.platform} · ${record.sourceUrl}`, record.timestamp]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    $('records').append(row);
  }
}
async function reload(force = false) {
  state = await request({ type: 'loadTerms', force });
  $('status').textContent = `Last successful sync: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'never'} · ${state.remoteRules.length.toLocaleString()} remote rules${state.syncError ? ` · Download error: ${state.syncError} · Cached rules remain available` : ''}`;
  if (state.definitionErrors?.length) notice(`Invalid source rules skipped:\n${state.definitionErrors.slice(0, 10).join('\n')}`);
  $('project').replaceChildren(...Object.entries(state.config.projects).map(([id, item]) => { const option = document.createElement('option'); option.value = id; option.textContent = item.name; return option; }));
  $('project').value = state.config.activeProject; $('auto-refresh').checked = state.config.autoRefresh; $('record').checked = project().recordMatches;
  $('delete-project').disabled = Object.keys(state.config.projects).length === 1;
  drawGroups(); drawRules(); await drawRecords();
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportRules(format) {
  const rules = allRules().map(rule => ({ ...rule, enabled: rule.enabled && !project().disabledGroups.includes(rule.group) }));
  const name = project().name.replace(/[^a-z0-9_-]/gi, '_');
  download(`${name}-rules.${format}`, format === 'csv' ? HighlightextRules.exportCSV(rules) : JSON.stringify({ schema_version: 2, rules }, null, 2), format === 'csv' ? 'text/csv' : 'application/json');
}
$('rule-form').addEventListener('submit', action(async event => {
  event.preventDefault();
  const rule = HighlightextRules.normalizeRule({ id: $('rule-id').value.trim(), type: $('rule-type').value === 'auto' ? undefined : $('rule-type').value, text: $('rule-text').value, flags: $('flags').value, kind: $('kind').value, category: $('category').value, group: $('group').value, color: $('color').value, enabled: $('enabled').checked, caseSensitive: $('sensitive').checked, wholeWords: $('boundaries').value });
  const target = $('scope').value === 'local' ? state.config.localRules : project().rules;
  const index = target.findIndex(item => item.id === rule.id); if (index >= 0) target[index] = rule; else target.push(rule);
  if ($('scope').value === 'project') delete project().overrides[rule.id];
  await save(); resetEditor(); notice('Rule saved. Reapply highlighting to update existing pages.');
}));
$('reset-editor').addEventListener('click', resetEditor);
$('project').addEventListener('change', action(async () => { state.config.activeProject = $('project').value; page = 0; await save(); resetEditor(); }));
$('create-project').addEventListener('click', action(async () => {
  const name = $('project-name').value.trim(); if (!name) throw new Error('Enter a project name.');
  const id = crypto.randomUUID(); state.config.projects[id] = { name, rules: [], overrides: {}, disabledGroups: [], options: { wholeWords: true, caseSensitive: false }, recordMatches: false };
  state.config.activeProject = id; await save(); $('project-name').value = ''; resetEditor();
}));
$('delete-project').addEventListener('click', action(async () => {
  if (!confirm(`Delete ${project().name} and its match and timeline records?`)) return;
  await request({ type: 'timeline:clear', projectId: state.config.activeProject });
  await request({ type: 'clearRecords', projectId: state.config.activeProject }); delete state.config.projects[state.config.activeProject]; state.config.activeProject = Object.keys(state.config.projects)[0]; await save(); resetEditor();
}));
$('auto-refresh').addEventListener('change', action(async () => { state.config.autoRefresh = $('auto-refresh').checked; await save(); }));
$('record').addEventListener('change', action(async () => { project().recordMatches = $('record').checked; await save(); }));
$('refresh').addEventListener('click', action(() => reload(true)));
$('search').addEventListener('input', () => { page = 0; drawRules(); });
$('previous').addEventListener('click', () => { page--; drawRules(); }); $('next').addEventListener('click', () => { page++; drawRules(); });
$('import-file').addEventListener('change', action(async () => {
  const file = $('import-file').files[0]; if (!file) return;
  if (file.size > 8 * 1024 * 1024) throw new Error('Imports are limited to 8 MiB.');
  const rules = HighlightextRules.importRules(await file.text(), /\.csv$/i.test(file.name) ? 'csv' : 'json');
  const target = $('import-scope').value === 'local' ? state.config.localRules : project().rules;
  const merged = new Map(target.map(rule => [rule.id, rule])); for (const rule of rules) merged.set(rule.id, rule);
  if ($('import-scope').value === 'local') state.config.localRules = [...merged.values()]; else { project().rules = [...merged.values()]; for (const rule of rules) delete project().overrides[rule.id]; }
  await save(); $('import-file').value = ''; notice(`${rules.length} rules imported.`);
}));
$('export-json').addEventListener('click', () => exportRules('json')); $('export-csv').addEventListener('click', () => exportRules('csv'));
$('records-json').addEventListener('click', action(async () => { await drawRecords(); download('highlightext-records.json', JSON.stringify(records.map(({ key, ...record }) => record), null, 2), 'application/json'); }));
$('records-csv').addEventListener('click', action(async () => {
  await drawRecords(); const fields = ['matchedText', 'ruleId', 'category', 'platform', 'sourceUrl', 'timestamp', 'projectId'];
  const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  download('highlightext-records.csv', [fields, ...records.map(record => fields.map(field => record[field]))].map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv');
}));
$('clear-records').addEventListener('click', action(async () => { if (confirm('Delete all saved matches in this project?')) { await request({ type: 'clearRecords', projectId: state.config.activeProject }); await drawRecords(); } }));
reload().catch(error => notice(error.message));
