# Highlightext

A dependency-free Manifest V3 extension for Chrome and Edge. Type or paste text
into the popup to highlight matches, or click **Highlight this page** to highlight
the current website. Page highlights update as the page or editable text changes.

## Install locally

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `highlighter` directory.
4. Pin Highlightext, open its popup, and wait for the first word list download.

No build step, API key, or runtime npm packages are required. Reload the extension
on the extensions page after changing its code; reload an already highlighted web
page to replace its injected script.

## Matching

The source is https://highlightext-org.github.io/words/master.json. The extension
extracts enabled keywords and their colors, explicit X handles (with and without
`@`), case-sensitive wallets, and profile URLs from schema version 1. Display
names and other arbitrary profile fields are not treated as keywords.

Choose categories, whole-word matching, or case-sensitive matching in the popup.
Matches are literal, case-insensitive by default, and prefer the longest match
when terms overlap. Wallets always require exact case. Settings apply immediately
in the popup; click **Highlight this page** again to apply new settings to a page.
The source's explicitly disabled keywords and profiles are excluded.

The parsed list is cached locally and refreshed when opening the popup if more
than 24 hours old. The refresh button forces a download. If a refresh fails, the
last successful list remains available. The first download requires internet.

## Page behavior and limits

Page highlights use the browser's CSS Custom Highlight API without replacing text
nodes, so links, selection, and editable content remain intact. Phrases can span
inline elements in a paragraph. **Clear page highlights** stops live updates and
removes only this extension's highlights. Each scan is capped at 5,000 matches.

Highlighting is enabled per page by clicking the button. Navigation or a reload
requires enabling it again. Browser settings, extension stores, PDFs, canvas,
shadow roots, and embedded frames are not supported. Native website inputs and
textareas cannot display CSS range highlights; use the extension's own text field
or a website's contenteditable editor. Hidden HTML and password fields are skipped.

## Privacy and permissions

The extension requests `activeTab` and `scripting` to highlight a page only after
your click, and `storage` for settings and the parsed word list. The only permanent
host permission is for the published JSON URL. No page content or pasted text is
uploaded. The popup draft is kept in browser session memory, not persistent local
storage. There is no analytics or remote executable code.

## Verify

With Node.js 18 or later, run `npm test`. Tests cover literal matches, overlapping
phrases, Unicode boundaries and offsets, exact-case wallets, categories, disabled
terms, schema validation, and unsafe-looking input. JavaScript can also be checked
with `node --check matcher.js` (and similarly for the other scripts).

For a browser smoke test, paste a listed keyword into the popup, toggle its
category, then highlight a regular page containing that word. Check an inline
phrase, edit a contenteditable field, and clear the page highlights. Test offline
refresh after one successful download to confirm the cached list remains usable.
