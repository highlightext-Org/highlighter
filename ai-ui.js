(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const editor = el('text');
  let settings, revision = 0, undo = null, loading = true;
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (result.error) throw new Error(result.error);
    return result;
  }
  function status(text, error = false) {
    el('ai-status').textContent = text;
    el('ai-status').dataset.error = String(error);
  }
  function drawProvider() {
    const account = settings.providers[el('ai-provider').value];
    el('ai-model').value = account.model;
    el('ai-key').value = '';
    el('ai-key-status').textContent = account.hasKey ? 'Key saved. Leave blank to keep it, or paste a replacement.' : 'No key saved for this provider.';
    el('ai-remove').disabled = !account.hasKey;
  }
  function replace(text) {
    editor.value = text;
    // Use the existing draft persistence and highlighting path.
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
  }
  editor.addEventListener('input', () => {
    revision++;
    undo = null; el('ai-undo').hidden = true;
  });
  el('ai-provider').addEventListener('change', () => { if (settings) drawProvider(); });
  async function save(removeKey) {
    el('ai-save').disabled = true; el('ai-remove').disabled = true; el('ai-provider').disabled = true;
    try {
      settings = await request({ type: 'ai:save', provider: el('ai-provider').value,
        model: el('ai-model').value.trim(), apiKey: el('ai-key').value.trim(), removeKey });
      drawProvider(); status(removeKey ? 'Saved key removed.' : 'AI settings saved. Ready to correct text.');
    } catch (error) { status(error.message, true); }
    finally { el('ai-save').disabled = false; el('ai-provider').disabled = false; el('ai-remove').disabled = !settings?.providers[el('ai-provider').value]?.hasKey; }
  }
  el('ai-save').addEventListener('click', () => save(false));
  el('ai-remove').addEventListener('click', () => save(true));
  el('ai-correct').addEventListener('click', async () => {
    if (loading) return;
    const original = editor.value, startedAt = revision;
    if (!original.trim() || original.length > 20000) { status('Enter between 1 and 20,000 characters to correct.', true); return; }
    if (!settings.providers[settings.provider].hasKey) { el('ai-settings').open = true; status('Add an API key and save AI settings first.', true); return; }
    el('ai-correct').disabled = true; el('ai-save').disabled = true; el('ai-remove').disabled = true;
    status('Correcting spelling and grammar…');
    try {
      // Keep Firefox's optional-data prompt inside the user's click gesture.
      const dataTypes = chrome.runtime.getManifest().browser_specific_settings?.gecko?.data_collection_permissions?.optional;
      if (dataTypes && !await chrome.permissions.request({ data_collection: dataTypes })) throw new Error('AI data access was not granted. Your text was not sent.');
      const result = await request({ type: 'ai:correct', text: original });
      if (revision !== startedAt) { status('You edited the text while correction was running. Your edits were kept.'); return; }
      if (typeof result.corrected_text !== 'string' || !result.corrected_text.trim() || result.corrected_text.length > 40000) throw new Error('The correction was invalid. Your text was not changed.');
      if (result.corrected_text === original) { status('No corrections needed.'); return; }
      replace(result.corrected_text);
      undo = { original, corrected: result.corrected_text };
      el('ai-undo').hidden = false;
      status('Spelling and grammar corrected. Review the result or undo.');
    } catch (error) { status(error.message, true); }
    finally {
      el('ai-correct').disabled = false; el('ai-save').disabled = false;
      el('ai-remove').disabled = !settings.providers[el('ai-provider').value].hasKey;
    }
  });
  el('ai-undo').addEventListener('click', () => {
    if (!undo || editor.value !== undo.corrected) return;
    const original = undo.original;
    replace(original); status('Original text restored.');
  });
  for (const id of ['ai-correct', 'ai-save', 'ai-remove', 'ai-provider']) el(id).disabled = true;
  request({ type: 'ai:settings' }).then(value => {
    settings = value; el('ai-provider').value = settings.provider; drawProvider();
    loading = false;
    for (const id of ['ai-correct', 'ai-save', 'ai-provider']) el(id).disabled = false;
    status(settings.providers[settings.provider].hasKey ? 'Ready to correct text.' : 'Add your API key in AI settings to correct text.');
  }).catch(error => status(error.message, true));
})();
