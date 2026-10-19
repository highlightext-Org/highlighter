# Highlightext

A shared Manifest V3 browser extension for Chrome/Edge 116+ and Firefox desktop
140+. Match literal keywords, handles, wallets, profile URLs, and regular
expressions using the central definitions source:
https://highlightext-org.github.io/words/master.json.

## Build and install

Requires Node.js 18+. No npm install, API key, or runtime npm packages are required.
Run from this directory:

```sh
npm run build
```

- Chrome/Edge: open `chrome://extensions` or `edge://extensions`, enable Developer
  mode, choose **Load unpacked**, and select `dist/chrome/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on**, and select `dist/firefox/manifest.json`. Temporary installs disappear
  on restart. Permanent distribution requires Mozilla signing.

Use `npm run build:chrome` or `npm run build:firefox` for one target. Edit the
shared source, rebuild, and reload the extension. Reload highlighted pages after
changing injected code. The source directory remains directly loadable in Chrome.
Android is not a tested target.

`manifest.json` is the base Chrome manifest. `manifests/firefox.json` overrides
background loading and browser metadata. Firefox uses an event page and direct
Web Workers. Chrome uses a service worker and an offscreen document hosting the
same matching worker. Firefox's stable add-on ID is
`highlightext@highlightext.org`; keep it stable after the first signed release.
Zip each build directory's contents with `manifest.json` at the archive root for
store submission. Build outputs contain extension assets and license files only;
building does not sign or publish anything.

## Handle follow queue

Open **Follow a list of handles** in the popup or sidebar. Paste handles or profile
URLs, then choose **Add to queue**. Plain handles use the selected platform; URLs
identify their platform automatically. Mixed lists can use `x:alice`, `fb:alice`,
`insta:alice`, and `tiktok:alice`. Separate entries with whitespace, commas, or
semicolons. Invalid entries are reported; duplicates are skipped. Lists are saved
locally per project (1,000 accounts per project, 5,000 total).

**Start X queue** visits pending X profiles using your signed-in browser session
and clicks the profile Follow button. Outcomes distinguish confirmed follows,
already-following accounts, pending follow requests, and blocked items. Keep the
manager tab open. Closing it interrupts the run; processing items require manual
review and explicit requeueing. **Stop** prevents the next action, although an
in-flight follow may finish. There is a 30-second pause between profiles, which
does not guarantee acceptance by X. Only one manager tab may run at a time.

X restricts automated bulk following; read its
[automation rules](https://help.x.com/en/rules-and-policies/x-automation).
Login prompts, dialogs, missing controls, and unconfirmed results stop the queue.
Platform UI changes may require selector updates. No credentials or API tokens
are collected. The runner reuses its own profile tab; the current profile stays visible for inspection.

Facebook, Instagram, and TikTok entries currently support **manual review**:
open the profile link, follow on the site, then choose **Mark reviewed** or
**Skip**. Reviewed is a manual status, not verification of a follow. Automatic
following is implemented for X only. Facebook imports accept username URLs;
numeric `profile.php?id=...` links are not supported. No actual social accounts
are followed by the automated test suite.

## Feature list

1. Download keyword **and regex** definitions from central `master.json`.
2. Support literal keywords and JavaScript regex patterns.
3. Explicit rule types, with auto detection for `pattern` fields and `/regex/flags`.
4. Groups for issues, campaigns, locations, and categories.
5. On-demand synchronization in the popup or rules manager.
6. Optional daily checks using browser alarms, also checking stale definitions
   when the UI opens. Disabled by default; browser scheduling may be delayed.
7. Local offline cache retained after download or validation failures.
8. Custom local rules for all projects and rules specific to a project.
9. Individual rule enable/disable and overrides that survive synchronization.
10. Case controls, Unicode-aware word boundaries, and JavaScript regex flags.
11. Regex syntax validation before activation; invalid remote rules are skipped
    with visible diagnostics, and invalid imports are rejected before saving.
12. Highlight rendered posts, comments, timelines, public biographies, and other
    ordinary page text after clicking **Highlight this page**. Watch live changes.
13. Optional local records containing matched text, rule ID, category, platform,
    source URL, timestamp, and project ID.
14. Import and export definitions as JSON or CSV; export records as JSON or CSV.
15. Separate rule sets, overrides, group selections, matching options, and recording
    settings for each campaign or research project.
16. Stream remote JSON and parse top-level array entries incrementally, discarding
    unrelated datasets such as holdings rather than materializing the whole file.
17. Deduplicate equivalent rules and resolve overlapping match ranges.
18. Priority: project overrides > project rules > local rules > remote definitions.
19. Display the last successful sync time, persistent download errors, and invalid
    source-rule diagnostics.
20. Isolate matching in a terminable worker, with regex deadlines and page limits.
21. Record browsed timeline posts on X, Instagram, and TikTok in the background,
    independently of keyword matches; stop, clear, and download JSON or CSV.
22. Keep the popup tools open alongside pages in a Chrome/Edge side panel or
    Firefox sidebar.

## Timeline recording and sidebar

Choose a project and click **Start recording** in the popup or sidebar. Recording
starts on all open supported tabs and attaches automatically to new supported
pages. It saves visible post text, author when available, a post permalink, the
timeline URL, publication time when available, and capture time. It keeps running
with the popup/sidebar closed while you browse and scroll, including after page
navigation. Recording is off until you start it. Only one project records at a
time; switching the project picker alone does not move an active recording.

**Stop** ends capture across tabs and keeps saved posts. **Download JSON** and
**Download CSV** export the current project's timeline records, including after
stopping. **Clear saved** deletes this project's timeline records and stops its
active recording. Other projects' records are retained. Deleting a project also
clears its timeline records. These controls are separate from keyword match
recording and clearing page highlights.

The background stores up to 5,000 timeline posts across projects within a 4 MiB
serialized storage budget, removing the oldest first. Export before that limit
if you need to retain everything. Repeated sightings of the same permalink are
saved once per project; without a permalink, author and text identify duplicates.
The first captured version is retained. Recording state survives browser restarts
and resumes on supported pages until stopped. It captures already loaded posts
as they appear in the viewport, without scrolling for you, downloading video
files, or fetching hidden content. Site layout changes may require adapter
updates; captions, authors, and timestamps depend on the rendered page.

Click **Keep open in sidebar** to open the same controls beside the current tab.
Chrome/Edge also list Highlightext in their side panel selector; Firefox lists it
in the sidebar selector. You can keep that panel open as you navigate.

## Using projects and custom rules

Open the popup and choose **Manage rules**. Create or select a project, select its
groups, and add or edit rules. Local rules apply to every project; project rules
apply to the selected project. Editing a remote rule reuses its ID so it overrides
the downloaded definition. Its override remains after future synchronization.
Disabling a rule in the table creates a project override. Removing an override
reveals the definition from the next lower source, if one exists.

The popup's category switches, whole-word setting, and case setting belong to the
selected project. Reapply **Highlight this page** to switch an existing page to a
different project. Already enabled pages stay attached to their original project;
their next live scan reads that project's current settings.

Enable **Save page matches locally** per project to record evidence. Recording is
off by default and applies only to pages, not pasted popup drafts. The latest
2,000 records across projects are retained, subject to a 2 MiB size limit; older
records are removed automatically. Repeated scans deduplicate the same project,
URL, rule, matched text, block, and offset. Dynamic layout changes can create a
new record for the same text at another position. Export records before retention
limits remove them. Clearing page highlights does not delete records; the rules
manager provides a separate project-specific clear action.

## Definition schema

Existing schema-version-1 `keywords`/`variants`, profile handles, case-sensitive
wallets, profile URLs, and disabled profile settings remain supported. Legacy
keyword `type: "positive"` or `"negative"` describes sentiment and stays literal.
Disabled rules are retained in the manager so they can be enabled individually.

The central file can also contain `rules`, `patterns`, and `groups`. Schema
versions 1 and 2 are accepted, or omit `schema_version` for a definitions-only
file. Example:

```json
{
  "schema_version": 2,
  "rules": [
    {
      "id": "campaign:school",
      "type": "literal",
      "text": "school closure",
      "category": "Education",
      "group": "Local campaign",
      "enabled": true,
      "wholeWords": true,
      "color": "#fde047"
    }
  ],
  "patterns": [
    {
      "id": "campaign:reference",
      "pattern": "CASE-\\d{4}",
      "flags": "i",
      "category": "References",
      "group": "Local campaign",
      "wholeWords": false
    }
  ],
  "groups": [
    {
      "id": "london",
      "name": "London",
      "category": "Location",
      "rules": [{ "id": "london:borough", "text": "Camden" }]
    }
  ]
}
```

Rule fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable ID used by overrides. Generated from matching content, group, kind, and category if omitted. Explicit stable IDs are recommended. |
| `type`, `ruleType`, `matchType`, or `match_mode` | `literal` or `regex`; `keyword` and `text` mean literal. The central word list uses `match_mode: "regex"`. |
| `text` / `pattern` | Keyword or regex source. A `pattern` field implies regex unless the type explicitly says literal. |
| `flags` | JavaScript flags such as `imsu`. Duplicate, unsupported, or incompatible flags are rejected. |
| `enabled` | Defaults to true. |
| `caseSensitive` | Defaults to false. True, or the project's case-sensitive option, removes the regex `i` flag. Otherwise matching adds `i`. Wallets are case sensitive. |
| `wholeWords` | True/false overrides project boundaries. Null or omitted inherits the project setting, which defaults to true. |
| `category`, `group` | Labels. `issue`, `campaign`, and `location` can supply group/category defaults. |
| `kind` | Popup filter: `keyword` (default), `handle`, `wallet`, or `url`. |
| `color` | Six-digit hex color; defaults to `#fde047`. |

Without an explicit type, slash-delimited `/pattern/flags` is detected as regex.
Other text, including punctuation such as `a+b`, stays literal. Explicit
`type: "literal"` preserves slash-delimited text as a literal keyword. Bare
strings in `patterns` are regex; bare strings in `keywords` or `rules` use auto
detection. Groups accept `rules`, `keywords`, and `patterns` arrays.

Equivalent active rules are deduplicated according to priority. Definitions in
different groups remain visible so disabling one group can reveal another.
At the same starting offset higher-priority rules win, then longer matches;
otherwise the earliest non-overlapping match wins. Empty regex matches are skipped.
A regex uses JavaScript semantics, not PCRE. `g` is always applied to find all
matches; sticky `y` retains its JavaScript behavior. Boundaries are checked on the
actual matched text rather than inserting regex `\b` into the user's expression.

## Import and export

The manager accepts JSON arrays of rule objects, or objects with the collections
above. CSV has a header row with `text` or `pattern`; optional fields use the same
names as the schema. The exported columns are:

```csv
id,type,text,flags,kind,category,group,color,enabled,caseSensitive,wholeWords
```

Quoted commas, quotes, newlines, BOMs, and boolean fields are supported. Imports
merge by ID into local rules or the current project. The entire import must
validate before saving. Exports flatten the current project's effective rules,
including disabled rules and groups; they are portable definitions, not a backup
of every project's source layers. Imports are limited to 8 MiB.

## Performance and page limits

- Remote downloads: 60 second timeout, 32 MiB maximum; preserve the previous
  successful cache if a download fails or no valid rules can be extracted.
- At most 500 active regex patterns per project; each regex execution has a 75 ms
  worker deadline and the overall scan has a 2 second budget. Timeouts terminate
  the worker and identify the slow rule or overall scan in the UI. Simplify or
  disable the pattern to resume matching. A subsequent scan uses a fresh worker.
- At most 5,000 displayed matches, 200,000 characters, 2,000 text blocks, and
  20,000 examined text nodes per page scan. Individual blocks/text nodes are
  limited to 20,000 characters. A page badge reports counts, errors, or truncation.
- Page updates are coalesced to at most one new scan per second, with one scan in
  flight per page and at most three matching workers across the extension.
- Popup previews accept 20,000 characters and debounce typing by 250 ms.
- At most 50 projects and 20,000 custom definitions per scope, subject to browser
  local-storage quotas. Large rulesets may need smaller imports.

CSS Custom Highlight ranges preserve text nodes, links, selection, and editable
content. Phrases can span inline elements in the same block; regex cannot cross
block boundaries or truncated chunks. Navigation/reload requires enabling again.
Browser pages, extension stores, PDFs, canvas text, shadow roots, and embedded
frames are unsupported. Native input/textarea range highlights are unsupported;
use the popup preview or contenteditable page text. Hidden/aria-hidden elements,
passwords, and input fields are excluded. Sites may impose additional extension
restrictions. Only already loaded page text is scanned; the extension does not
crawl profiles, load comments, or fetch private content.

## Privacy and permissions

`activeTab` and `scripting` enable page highlighting after your click. `storage`
keeps definitions, settings, and optional match and timeline records. `alarms` enables daily
checks when selected. Chrome's `offscreen` permission hosts the worker; Firefox
does not request that permission. Chrome's `sidePanel` permission enables the
persistent sidebar. Website permissions cover the published definitions host
and X/Twitter, Instagram, and TikTok so recording can continue across navigation
while the popup is closed. Recording scripts remain idle until recording starts.
After updating, accept the added site permissions if the browser requests them.
If Firefox blocks its download, allow the word-list
host in the extension's website permissions in `about:addons`.

No page content, pasted text, custom rules, match records, or timeline records are uploaded. There
is no analytics or remote executable code. The word-list server receives normal
download requests. Popup drafts use browser session storage, not persistent local
storage. Definitions/configuration and enabled recording do persist locally until
removed or the extension is uninstalled. The Firefox manifest declares no user
data transmission; revisit that declaration if future features upload user data.

## Verify

```sh
npm test
npm run build
npx web-ext lint --source-dir dist/firefox --warnings-as-errors
```

Tests cover matching and Unicode offsets, rule types, schema compatibility,
priority and disable overrides, groups, CSV/JSON round trips, streamed UTF-8,
offline failures, record isolation/deduplication, browser build startup, and
terminating catastrophic regex execution in a real worker thread.

Browser smoke checklist for both builds: sync definitions, create a project,
add a regex, preview it, import/export rules, enable optional recording, highlight
an ordinary page with inline and editable content, mutate its text, and inspect
records. Disable a group or individual rule, reapply highlighting, and clear the
page. Test offline refresh after one successful download and verify the cache and
last successful timestamp remain. Confirm a slow pattern stops without hanging
the page and that disabling it allows matching again.

## Community tier — free open-source tools

The Community tier is **free ($0)**: use the open-source tools without a
subscription or purchase. Company-owned software and associated technical
documentation are available under the [MIT License](LICENSE), including its
**AS IS / no-warranty / no-liability** provisions. Community support is best
effort; maintenance and updates are not guaranteed.

Read [license scope and software disclaimer](DISCLAIMER.md) before use. The
software license does not grant rights in branding, third-party material,
personal information, or generated datasets. Test suitability, verify results,
and keep backups. Liability exclusions apply only to the extent permitted by law.
Paid plans and custom services are separate from Community software rights.
