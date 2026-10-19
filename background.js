importScripts('matcher.js');
const SOURCE = 'https://highlightext-org.github.io/words/master.json';
let pending;

async function loadTerms(force) {
  const cached = await chrome.storage.local.get(['terms', 'updatedAt']);
  if (!force && cached.terms?.length && Date.now() - cached.updatedAt < 86400000) return cached;
  // Share one in-flight refresh across popup requests to avoid duplicate downloads.
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch(SOURCE, { cache: 'no-cache', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Word list download failed (HTTP ${response.status}).`);
    const terms = Highlightext.extractTerms(await response.json());
    if (!terms.length) throw new Error('The word list contains no enabled terms.');
    const result = { terms, updatedAt: Date.now() };
    await chrome.storage.local.set(result);
    return result;
  })();
  try { return await pending; }
  finally { pending = null; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'loadTerms') return;
  loadTerms(message.force).then(data => respond({ ok: true, ...data }), async error => {
    // Keep the last valid list usable when the network or a new export fails.
    const cached = await chrome.storage.local.get(['terms', 'updatedAt']);
    respond({ ok: false, error: error.message, ...cached });
  });
  return true;
});
