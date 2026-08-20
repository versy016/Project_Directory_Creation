# Restructuring plan

Working document for the incremental restructure of Project Directory Creation.

Baseline is **v1.1.5** — the state of `script.js` and `main.js` before any of this
began. Tag it so the oracle below always has something to point at:

```
git tag v1.1.5-prerefactor <commit-of-1.1.5> && git push --tags
```

## The three verification layers

```
npm test        107 unit + config tests, ~0.2s, no drives required
npm run smoke   loads the real renderer in Electron, ~5s -- does it still evaluate?
npm run e2e     drives the real UI against a sandbox, ~20s -- does it still work?
```

Each layer catches what the one above cannot:

- **`npm test`** never touches `script.js`. It can be fully green while the app is
  completely broken.
- **`npm run smoke`** loads the real `index.html` in a hidden window and fails on any
  uncaught error, any missing global an inline `onclick` needs, or any missing DOM
  node. It proves the renderer *loads*, not that it *works*.
- **`npm run e2e`** builds a throwaway drive tree, points the app at it with the
  `PDC_*` variables, then fills in the client box, clicks Search, ticks a sync
  checkbox, creates a project — and asserts against the files that land on disk.
  18 checks. It never touches `C:\_Clients`, `G:` or `J:`.

Run all three before every commit. The e2e layer exists because Phase 3 moves shared
mutable state across module boundaries, and that class of bug loads perfectly
cleanly — it just writes projects to the wrong drive.

## The three rules

1. **Never move code and change behaviour in the same commit.** Extraction commits
   must leave `npm test` green without touching a single expected value. Behaviour
   commits change tests and code together, and nothing else. This is what keeps
   `git bisect` meaningful.
2. **The app must launch after every commit.** If it doesn't, the commit was too big.
3. **Never edit the oracle to make a test pass.** See below.

## How the tests are built

`tests/legacy/legacy-implementations.js` holds **verbatim copies** of the pure
functions as they exist in `script.js` at the baseline tag. Every extracted module
is tested by running both implementations over an input matrix and asserting the
outputs are identical — 108 combinations for the FreeFileSync XML generator alone.

That file is the safety net. When a Phase 2+ change intentionally alters behaviour,
**delete the affected oracle function in the same commit** and replace its equality
test with an explicit expected-value test. Editing the oracle so a test goes green
silently destroys the guarantee.

Tests are also written to document quirks, not just to pass. Anything labelled
`QUIRK`, `DEAD BRANCH` or `BUG (frozen)` is asserting *current wrong behaviour* on
purpose, so that fixing it later shows up as a deliberate, reviewable diff.

## Phase status

| Phase | Scope | State |
|---|---|---|
| 0 | Sandbox path indirection, safety net | **done** |
| 1 | Extract pure logic, golden tests | **done** |
| 2 | Rewire `script.js` to `src/core/`, delete the duplicates | **done** |
| 3 | Split renderer into modules | **done** |
| 4 | Extract services, thin the DOM handlers | **done** |
| 5 | `contextIsolation: true`, real preload | **done** |
| 6 | Rotate and externalise secrets | not started |

### What Phase 0 + 1 delivered

- `src/config/roots.js` — every drive root in one place, each overridable by an
  environment variable so the whole app can run against a scratch folder.
- `src/core/paths.js` — `getSharedDrivePath`, plus `forType()`, which collapses the
  `if (creationType === 'quoteDirectory')` branch currently repeated ~12 times.
- `src/core/project-name.js` — validation pattern, normalisation, year extraction.
- `src/core/sorting.js` — project ordering and the three-way drive partition.
- `src/core/ffs-config.js` — all FreeFileSync XML reading, generating and merging,
  **including the previously-missing `createFullXmlConfig`**.
- `src/core/format.js` — byte and date-label formatting.

Nothing in `script.js` has changed yet. The extracted modules are additive and
unreferenced by the running app, so Phase 1 carries zero deployment risk.

### What Phase 2 delivered

`script.js` went from 2068 to ~2160 lines gross, but ~250 lines of duplicated logic
were deleted and replaced by calls into `src/core/`. Every live drive-path literal
is gone — the only two left (`G_DRIVE_PATH` at `script.js:13`, `outputPath` at
`script.js:243`) belong to the archive/report feature whose event handlers are
commented out, so they were left untouched rather than refactored blind.

Deleted from `script.js`, now sourced from `src/core/`:
`getSharedDrivePath` body, `formatBytes`, `extractYearFromProjectName`,
`sortProjects`, the partition block, the project-name regex and normalisation,
`parseExistingPairsToSet`, `generateFolderPairsXml`, `appendFolderPairsToExistingXml`,
and the parse half of `readAndProcessXmlConfig`. `readExistingXmlConfig` stays — it
does file I/O and moves to `services/fs-repo` in Phase 4.

The `.ffs_gui` three-way branch was duplicated at four call sites; all four now call
`ffsConfigPath(creationType, selectedDrive)`. Collapsing it is what exposed bug #25.

Deliberate deviations, none observable:

- In quote mode `searchForClient` used to read the client-project config and throw
  the result away before reading the quotes config. The wasted read is gone.
- The `console.log` diagnostics in `getBaseDirectories` were dropped. The ones in
  `getSharedDrivePath` were kept, in the adapter — they catch typos in
  `majorClients.json`, which is hand-edited on the share.

### How Phase 2 was verified

`npm test` cannot see `script.js`, so `npm run smoke` was added: it loads the real
`index.html` in a hidden Electron window with the app's own `webPreferences` and
fails on any uncaught error, any missing global that an inline `onclick` depends on,
or any missing DOM node. A **baseline was captured against unmodified `script.js`
before any edit**, then the suite plus smoke was re-run after every step.

Renderer `require` resolution was proven before the first edit, using a throwaway
Electron app that replicated the layout: `require('./src/core/...')` from a
`<script src>` at the app root resolves against the app root, and nested intra-core
requires work. That was the single biggest risk in the phase.

### Phase 3 progress

`script.js`: **2341 → 1172 real lines.** Eight modules out, each verified with all
three layers before moving on.

| Module | Contents |
|---|---|
| `renderer/state.js` | the three shared `let`s behind one object |
| `renderer/update-banner.js` | updater notice, progress, Install, `refreshApp` |
| `renderer/sync-controls.js` | direction column, `collectSyncSettings`, row alignment |
| `renderer/project-tables.js` | `populateProjects`, row buttons, copy actions |
| `renderer/new-client-form.js` | client + contact creation, contact autocomplete |
| `renderer/major-clients.js` | `loadMajorClients`, `getSharedDrivePath` adapter |
| `services/fs-repo.js` | every filesystem call the renderer makes |
| `services/algolia.js` | index refresh (write) and search indices (read) |

Read the comment at the top of `state.js` before touching it. It is exported as an
object rather than as three bindings because CommonJS copies primitives at
destructure time — `const { selectedDrive } = require('./state')` would snapshot the
empty-string default and never see an update, which loads cleanly and silently
writes projects to the wrong drive. Always reach through `state.<field>`.

**The require cycle, and how it was broken.** `project-tables` renders rows,
`client-search` decides what to render — but copying a project has to refresh the
tables afterwards, which is `client-search`'s job. A naive split gives
`project-tables → client-search → project-tables`, which fails at load. The edge is
inverted at init instead, so nothing imports upward:

```js
initProjectTables({ onProjectsChanged: searchForClient });
```

Use the same shape for anything else that needs to call back up.

Also deleted as part of this phase, both provably unreachable:

- the archive / client-report feature (`showLargeProjects`, `generateClientReport`,
  `processClientFolders`, `zipFolder`, `getFolderDetails`, the duplicate
  `getFolderSize`) — every entry point was commented out and the code referenced an
  undeclared `clientBasePath`, so it would have thrown on first call. Removing it
  also retired the last two hardcoded drive literals.
- `copygtoc` — its only three call sites were inside commented-out blocks.

The final two modules — `client-search` and `new-project-form` — completed the
phase. `script.js` is now 106 lines: requires, the two main-process message
handlers, three small modal handlers, and an ordered list of `init*()` calls.

`createProject` ended up in `new-project-form`, not `project-tables`: it opens and
pre-fills that form rather than rendering anything. `project-tables` only emits the
onclick naming it, so neither module imports the other.

`new-project-form` imports `client-search` directly. That is not a cycle —
`client-search` does not import it back. Only the `project-tables` edge needed
inverting.

### A regression this phase, and what it changed

Rewriting the shared-state references with a blanket `\bmajorClients\b` regex also
rewrote `jsonData.majorClients` into `jsonData.state.majorClients`, breaking
`loadMajorClients` so the list silently stayed empty.

**Every e2e check still passed**, because the fixture client (ACME) is not a major
client and routes identically either way. Only `npm run smoke` noticed, and only as
a console note. The gap is now closed: the sandbox has a major client
(FULTON HOGAN) and a scenario asserting it resolves directly under the shared base
rather than into `_F`. That check was confirmed non-vacuous by reintroducing the bug
and watching it fail.

Two lessons worth keeping: run **all three** layers after each step, not whichever
is convenient; and a blanket identifier rewrite will happily edit property accesses,
string literals and comments — grep the diff for the new name afterwards.

### What Phase 4 delivered

- `services/project-service.js` — the whole create-a-project sequence, with no DOM
  and no electron. `new-project-form` now reads the form into a plain request
  object, validates it, and calls the service.
- `services/ese-api.js` — the two live API writes, out of `new-client-form`.
- `services/fs-repo.js` resolves `ipcRenderer` defensively, so services built on it
  run outside a renderer. That is what makes them unit-testable.
- `tests/services/project-service.test.js` — 7 tests, no Electron, ~100ms.

**Bug #28 fixed: the shared template is no longer mutated.** The dated transfer
folders are created in the new project after the template copy rather than inside
the template beforehand.

The test for it is worth understanding before you touch it. A before/after snapshot
of the template is **not** sufficient — the old code created and then deleted, so
the snapshot came back identical and the test would have passed against the bug.
The guard therefore watches the template directory with `fs.watch` during the
operation and asserts zero events. Verified non-vacuous by reintroducing a
create-then-delete and confirming it fails.

The e2e assertions for this behaviour were deliberately written against the
*outcome* (folders land in the project, template left clean) rather than the
mechanism, and passed unchanged across the fix — which is the point.

### What Phase 5 delivered — and where the plan was wrong

The app now runs with `contextIsolation: true`, `nodeIntegration: false` and a real
preload. The page has no `require`, `process`, `module` or `electron` — asserted at
runtime by `npm run smoke`, not just in config.

**The plan called this "a one-file change". It was not.** That prediction assumed
`require` would survive in the renderer. It does not: enabling `contextIsolation`
removes it from page scripts regardless of the `nodeIntegration` setting (verified
across all three combinations). `<script src="script.js">` could therefore no
longer load `src/renderer/*`.

The choice was a bundler or moving the renderer into the preload, which keeps Node
(`sandbox: false`) and shares the page's DOM. The preload route was taken, since
this refactor has deliberately avoided adding build tooling. `script.js` is gone;
`preload.js` is the renderer entry point. See `src/preload/README.md`.

Two further findings while doing it, both caught by the new guards rather than by
inspection:

- `main.js` created **two more windows** — the copy-progress window and the alert
  modal — still running `nodeIntegration: true`. Neither has any script beyond an
  inline `window.close()`. Both hardened.
- `client-search` still called `fs.existsSync` directly, bypassing the `fs-repo`
  chokepoint the whole layering depends on. Routed through a new `pathExists`.

`tests/release/security.test.js` now guards all of it, because flipping
`contextIsolation` back off changes no visible behaviour and would otherwise pass
every other test in the suite.

### Sandbox run

Now live — `script.js` reads every root from `src/config/roots`:

```
set PDC_LOCAL_ROOT=D:\pdc-sandbox\C\_Clients
set PDC_ACCTS_ROOT=D:\pdc-sandbox\C\__Accounts\__Clients
set PDC_SHARED_ROOT=D:\pdc-sandbox\G
set PDC_FFS_DIR=D:\pdc-sandbox\ffs
npm start
```

`npm run smoke` prints the resolved roots, so a sandbox run is self-evident:

```
ok    roots.localClients = D:\pdc-sandbox\C\_Clients
ok    roots.sharedBase   = D:\pdc-sandbox\G
```

## Bug register

Severity is about blast radius on the shared drives, not code tidiness.

| # | Sev | Where | What | Status |
|---|-----|-------|------|--------|
| 1 | HIGH | `index.html:278` | Dropdown emits `"Update LEft"` (capital E); no branch matches. On a G: bucket this writes a `<Pair>` containing the literal text `undefined` for Left, Right and Differences straight into the real `SyncSettings.ffs_gui`. On J: it throws instead. | frozen by test |
| 2 | HIGH | `script.js:1422, 2330` | `createFullXmlConfig()` called but never defined — the "config file missing" fallback threw `ReferenceError` in exactly the case it existed to handle. | **fixed** in `src/core/ffs-config.js`, awaiting Phase 2 wiring |
| 3 | MED | `script.js:1522` | OHS copy tests `access(ohsSourceSecondary)` then copies `ohsSourcePrimary`. `script.js:1508` has the mirror error. | open |
| 4 | MED | `script.js:8` | `require('node-fetch')` but it is not in `package.json` — resolves only via a stale transitive v1.7.3. A clean install breaks the entire renderer. Electron 30 has global `fetch`; delete the require. | open |
| 5 | MED | `script.js:9, 388, 2089` | Algolia app ID + two keys and the ESE Basic token hardcoded in committed source. One Algolia key has write access (`saveObjects`, `clearObjects`). Rotation is mandatory — they are in git history. | open |
| 6 | LOW | `script.js:92, 1094` | `getFolderSize` defined twice; the second silently wins and they differ in error handling. | open |
| 7 | LOW | `index.html:506`, `script.js` ×2 | `window.onclick` assigned three times. **Correction:** the winner is index.html's, not script.js's — index.html assigns inside a `DOMContentLoaded` handler, which runs after script.js's top-level code. So the info-modal close works and *both* script.js handlers are dead, the opposite of what was first recorded here. Converting all three to `addEventListener` is the fix. | open |
| 8 | LOW | `script.js:1588` | `.reset()` called on `#newProjectForm`, which is a `<div>` → TypeError. | open |
| 9 | LOW | `main.js:159` | `ipcRenderer.send` inside a main-process handler; `ipcRenderer` does not exist there. Channel appears unused. | open |
| 10 | LOW | `script.js:933, 971` | `copygtoc` adds a fresh click listener on every call, so repeat use fires the copy N times. | open |
| 11 | LOW | `script.js:320, 333` | `update-available` handled twice — native alert *and* in-page banner. | open |
| 12 | LOW | `script.js:18` | `selected_drive` starts `''`; any path built before the first Search resolves against an empty base. | open |
| 13 | LOW | `script.js:1455, 1463` | `fs.promises.rmdir({recursive})` deprecated since Node 16; use `fs.rm`. | open |
| 14 | INFO | `script.js:2033` | Cross-drive skip compares against a backslash literal `getSharedDrivePath` can never return (it emits forward slashes), so J: pairs are never filtered from the G: config. | frozen by test |
| 15 | INFO | `script.js:64` | `getSharedDrivePath` returns forward slashes while every other root uses backslashes, so generated XML carries mixed separators. | frozen by test |
| 16 | INFO | `script.js:1620` | `gDriveProject` derived via `left.includes('G:\\')`, which never matches this app's own output. Currently invisible because the UI only substring-tests it. | frozen by test |
| 17 | INFO | `archiveprojects.js` | Entirely commented out, still `<script src>`'d at `index.html:454`. | open |
| 18 | INFO | `main.js:66` | `nodeIntegration: true` / `contextIsolation: false` with an empty `preload.js`. | Phase 5 |
| 19 | HIGH | `package.json` build.files | `"!src/"` excluded the entire new source tree from the installer. Tests pass, `npm start` works, and only the *installed* app crashes — on the first `require('./src/core/...')` once Phase 2 lands. | **fixed**, guarded by `tests/release/packaging.test.js` and `scripts/verify-build.js` |
| 20 | HIGH | `package.json` scripts | `dist` carried `--publish always`, so building *was* releasing, straight into an auto-download + install-on-quit update chain. | **fixed** — `dist` no longer publishes; `release:draft` does, as a draft |
| 21 | MED | `package.json` root | The `publish` block sat at the root, where electron-builder never reads it (confirmed against `dist/builder-effective-config.yaml`). `releaseType: "release"` was never in effect. | **fixed** — moved into `build.publish`, pinned to `draft` |
| 22 | MED | `main.js:173-174` | `config.json` is gitignored and read with no error handling. On a fresh clone the read throws inside `whenReady`, silently killing both the `directory-existence` and `api-key` messages — so the Quote radio never hides and Places autocomplete never loads, with no visible error. | open |
| 23 | LOW | `main.js:76, 96` | `checkForUpdatesAndNotify()` runs twice per launch (once on `ready`, once on `ready-to-show`), so `update-available` can fire twice and call `downloadUpdate()` twice. | open |
| 24 | INFO | `main.js:87` | `process.env.ELECTRON_BUILDER_NO_DELTA = '1'` is set at runtime in the packaged app; it is a build-time variable, so it does nothing. `.exe.blockmap` is still produced. | open |

| 25 | HIGH | `script.js` btnSubmit | The read branch loading the existing `.ffs_gui` never checked for the J drive, while the write branch did. On J, creating a project read `SyncSettings.ffs_gui` (the G config), appended the new pair, and wrote the result to `SyncSettingsJdrive.ffs_gui` — **replacing the J config with a copy of the G one and destroying every folder pair it held**. Found by collapsing the duplicated branch in Phase 2. Compare commit `1a1f6d2`, "fixed bug of freefilesync folder pairs getting deleted". | **fixed** in Phase 2 |
| 26 | MED | `script.js` loadMajorClients | `JSON.parse` throws on a UTF-8 BOM, and the catch silently falls back to an empty list. `majorClients.json` is hand-edited on the share, so one save from Notepad as "UTF-8 with BOM" sends **every** major client into the wrong `_<Letter>` bucket with no visible error — only a console line nobody sees. Strip the BOM before parsing, or surface the failure in the UI. | open |

| 27 | HIGH | `project-service.copyToShared` | Creating a project while the **J toggle is on** checked J for an existing project but copied to the **G** bucket, because the copy re-derived the root from the client name via `getSharedDrivePath`, which only ever returns a G path. The project silently landed on the wrong drive. | **fixed** — one resolved `sharedRoot` now drives both; covered by an e2e J-drive scenario and two unit tests |
| 12 | LOW→MED | `state.js` | `selectedDrive` starts `''` until the first Search. Fixing #27 by using the mode's shared root alone would have made that empty value produce a **relative** destination — writing the project next to the executable. `project-service` now falls back to `resolveSharedRoot(clientName)`, with a unit test asserting no relative path is ever produced. The wider issue (other code paths still read the empty value) remains. | partly addressed |
| 28 | MED | `project-service` (fixed) | The dated TransIn/TransOut folders were created inside the **shared** `_PDIR_Defaults` template so the template copy would pick them up, then deleted again — briefly mutating a network directory every other user reads from. Two people creating projects at the same moment could see or delete each other's folders. | **fixed** in Phase 4; guarded by a watcher-based test |

Release-pipeline detail lives in [RELEASE.md](RELEASE.md).

## Deliberate deviations from the original

Three places where the extracted code is knowingly *not* a byte-for-byte port. Each
is proven unobservable by a test, and each is labelled `DEVIATION` in the suite.

- `sortProjects` returns a copy instead of sorting the caller's array in place.
- `generateFolderPairsXml` no longer rewrites `project.name` while escaping `&`.
- `normaliseProjectName` accepts `null`/`undefined` instead of throwing.

## Deliberately not doing (yet)

TypeScript, a bundler, a UI framework, CSS reorganisation. Each is defensible alone;
each would double the diff of whichever phase it landed in. Revisit after Phase 6.
