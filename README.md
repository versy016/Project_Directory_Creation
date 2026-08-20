# Project Directory Creation

An internal Windows desktop app (Electron) for Engineering Surveys. It standardises
how project and quote folders are created, keeps the local workstation and the
shared drives in step, and maintains the FreeFileSync configuration that does the
actual syncing.

Without it, people create job folders by hand: the naming drifts, the folder
structure varies, half the jobs never make it off the local disk, and the
FreeFileSync config gets edited by hand until it breaks. This app is the one place
that knows the conventions.

---

## What it actually does

**Creates a job folder from a template**, in the right place, with a valid name.
A project is named `YYYY_<Ref>_<Description>` (e.g. `2026_UP1283_Regency_Rd_Broadview`).
The name is validated — a folder without a year prefix is rejected — and the
structure is copied from a shared template rather than invented each time. Optional
overlays (DIT, RPAS, OHS, dated TransIn/TransOut) are added on request.

**Puts it on the correct drive.** Local first, then copied to the shared drive under
the client's folder. Which shared folder that is depends on rules the app knows and
people don't reliably remember (see *Drive layout*).

**Writes the FreeFileSync folder pair.** So the job actually stays in sync from then
on, instead of relying on someone remembering to add the pair by hand.

**Shows you what is where.** Search a client and you get two columns — what is on
the local drive, what is on the shared drive — with the sync direction between them,
and buttons to copy either way. Projects that exist *only* on the local disk and
have no folder pair are flagged: those are one dead hard drive from being lost.

**Finds a project when you know the job but not the client.** Type into the Project
box and it narrows across every client on both drives, badging each hit `Both`, `C`,
`G` or `J`. Picking one fills in the client and narrows the tables to it.

**Repairs broken FreeFileSync configs.** Runs at launch. See *FreeFileSync repair*.

**Registers new clients** against the ESE API, and keeps the Algolia client index
searchable.

---

## Drive layout

Three roots, all overridable by environment variable (see `src/config/roots.js`).

| | Path | Notes |
|---|---|---|
| Local projects | `C:\_Clients` | the workstation copy |
| Local quotes | `C:\__Accounts\__Clients` | |
| Shared projects | `G:\Shared drives` | Google Shared Drive, **bucketed** |
| Shared quotes | `G:\Shared drives\Accounts QT\__Accounts\__Clients` | flat |
| J drive | `J:\__Clients` | alternative shared target, flat |

**Clients are keyed by ES Reference, not by name.** Every folder is named by the
reference (`UPC`), not the trading name (`United Precast`). This matters constantly:
the search box, the folder paths and the FreeFileSync pairs all use the reference.

**G: is bucketed by first letter.** A client goes to `G:/Shared drives/_U/UPC`, using
`_A` .. `_Z`, or `_Misc` if the name does not start with a letter. **Major clients
are the exception** — they sit directly under `G:/Shared drives/<CLIENT>`, no bucket.
The list of major clients is a JSON file on the share
(`_Admin/IT_Utilities/Development/majorClients.json`), read at launch. J: and the
quotes share are flat — no bucketing.

**`sharedBase` uses forward slashes** (`G:/Shared drives`) while every other root
uses backslashes. This is deliberate and load-bearing: it is what the original
`getSharedDrivePath` produced, it leaks into the generated FreeFileSync XML as mixed
separators, and FreeFileSync accepts it. Several `includes('G:\\')` checks in the
codebase never match *because* of it. Do not "tidy" this without a test that pins
the new behaviour.

### FreeFileSync configs

Three `.ffs_gui` files in `C:\Freefilesyncfiles`, picked by mode and drive:

| Mode | Config |
|---|---|
| Client project, G: | `SyncSettings.ffs_gui` |
| Client project, J: | `SyncSettingsJdrive.ffs_gui` |
| Quote directory | `SyncSettings_Quotes.ffs_gui` |

---

## Running it

```bash
npm install
npm start
```

**You also need `config.json` in the project root.** It holds the Google Maps API
key and is gitignored, so a fresh clone does not have it — copy it from another
machine or ask.

Without it the app **fails in a way that does not look like a missing file**:
`main.js` reads it with `JSON.parse(fs.readFileSync(...))` and no error handling,
inside `app.whenReady()`. The throw kills the rest of that block, so the Quote
Directory radio never appears, Places autocomplete never loads, and the Google Drive
check never runs — with no visible error. This is a known open bug; if the app looks
half-dead on a fresh clone, check for `config.json` first.

### Developing against a sandbox

Every drive root reads from an environment variable, so you can point the whole app
at a throwaway tree instead of the real network drives:

```bash
set PDC_LOCAL_ROOT=D:\sandbox\C\_Clients
set PDC_SHARED_ROOT=D:\sandbox\G
set PDC_FFS_DIR=D:\sandbox\ffs
npm start
```

The full list is in `src/config/roots.js`. This is the same mechanism the e2e suite
uses, and it is the only safe way to exercise creation and sync logic without
writing to the real shared drives.

---

## Architecture

Electron 30, CommonJS, no bundler, no TypeScript, no UI framework. That is a
deliberate choice — the app is small and the build stays trivial.

```
main.js          main process: window, updater, IPC, launch checks
preload.js       renderer entry point + the contextBridge allow-list
index.html       the single page
src/
  config/        drive roots, all env-overridable
  core/          pure logic: no fs, no DOM, no electron
  services/      impure but DOM-free: fs, HTTP, Algolia, ESE API
  main/          main-process modules (Drive detection, alert modal, status window)
  renderer/      UI modules
```

Dependencies point one way, and never back:

```
renderer/ ──▶ services/ ──▶ core/ ──▶ config/
main/     ──▶ services/ ──▶ core/ ──▶ config/
```

### The renderer lives in the preload

This surprises everyone, so it is worth stating plainly: **there is no page script.**
`preload.js` is the renderer entry point.

`contextIsolation` is on. The moment it is enabled, `require` disappears from page
scripts — for both `nodeIntegration` settings, verified:

| Config | `require` in a page script |
|---|---|
| nodeIntegration true, contextIsolation false | available |
| nodeIntegration true, contextIsolation **true** | **gone** |
| nodeIntegration false, contextIsolation true | **gone** |

So a `<script src>` could not load the module tree. The options were a bundler or
moving the renderer into the preload, which keeps Node (with `sandbox: false`) and
shares the page's DOM. The preload route avoids adding build tooling.

**Assigning to `window` in the preload does not reach the page.** It lands on the
isolated world's window. Inline `onclick` attributes — in `index.html` and in the
table rows `project-tables` generates — run in the page's *main* world, so anything
they call must go through `contextBridge`. The exposed surface is a named allow-list
of seven functions in `preload.js`. There is deliberately no generic `invoke` or
`ipcRenderer` bridge; that would hand the page every channel.

A missed bridge is **silent** — the button simply does nothing, with no error
anywhere. `npm run smoke` asserts all seven are present.

### Module map

| Module | Owns |
|---|---|
| `core/paths` | every path derivation, bucketing, which config file a mode uses |
| `core/project-name` | name validation and year extraction |
| `core/project-filter` | narrowing, filtering, sorting and paging the two tables |
| `core/project-index` | matching for the project search box |
| `core/ffs-config` | generating and parsing `.ffs_gui` XML |
| `core/ffs-repair` | fixing corrupted sync-direction blocks |
| `core/ffs-paths` | validating and correcting folder-pair paths |
| `services/fs-repo` | **every** filesystem call the renderer makes |
| `services/project-service` | the whole create-a-project sequence |
| `services/ffs-repair-service` | the launch-time config repair |
| `services/algolia` / `ese-api` | the external APIs |
| `main/google-drive` | detecting and starting Google Drive for Desktop |
| `renderer/client-search` | `searchForClient`, the app's central refresh |
| `renderer/project-tables` | the two drive tables and their row buttons |
| `renderer/project-search` | the project/quote search box |
| `renderer/sync-controls` | the middle direction column |
| `renderer/new-project-form` | creation, Create Folder Pairs, Open FreefileSync |

---

## Invariants that will bite you

These are the non-obvious ones. Each has been broken at least once.

**`core/` must stay pure.** No `fs`, no `electron`, no `document`. This is why the
unit suite runs in under a second with no network drive mounted. The moment a core
function needs to read a file, it is in the wrong layer — pass the data in.

**`services/fs-repo` is the only filesystem chokepoint.** Nothing above it imports
`fs`. A stray `require('fs')` in a renderer module quietly undoes the isolation
work. A test asserts this.

**The two project columns are aligned by row index.** The middle sync-direction
column is positioned against C-drive rows *by index*, so row `i` on the left must be
the same project as row `i` on the right. Every view therefore emits the shared
projects first, in the same order, in both columns; exclusives only ever follow.
Break it and the direction dropdowns silently line up against the wrong projects —
which then writes the wrong pairs.

**Never write into the shared template.** The dated TransIn/TransOut folders used to
be created inside the shared `_PDIR_Defaults` template so the copy would pick them
up, then deleted again — mutating a directory every other user reads from,
mid-operation. They are now created in the project after the copy. A test watches
the template with `fs.watch` during creation and fails on any event (a before/after
snapshot would not catch create-then-delete).

**One resolved `sharedRoot` drives both the existence check and the copy.** Deriving
it twice is what made projects created with the J toggle on get checked against J
but copied to G.

**Dependency cycles fail at load, not at review.** `project-tables` needs to refresh
the tables after a copy, which is `client-search`'s job — the one place the graph
would loop. That edge is inverted at startup:

```js
initProjectTables({ onProjectsChanged: searchForClient });
```

Use the same shape for any future upward callback.

---

## FreeFileSync repair

FreeFileSync's *"use database file to detect changes"* option rewrites the
`<Differences>` block of a folder pair into a `<Changes>` block. The app's parser
does not recognise that shape, so those pairs become invisible to it — and manual
edits then compound the damage.

At launch the app scans all three configs and repairs two classes of problem:

- **Shape** — `<Changes>` blocks converted back to `<Differences>`, without touching
  the legitimate top-level global `<Changes>` element. Delete rules are never
  promoted to two-way.
- **Paths** — pair paths validated against what they should be for that client and
  project, across G: *and* J:, and corrected. Comparison is done in escaped space,
  because double-escaping is invisible once you unescape.

A `.bak` is written before the config, and the user is told what changed so they can
review it.

---

## Testing

Three layers. Run all three before committing.

```bash
npm test        # 272 unit tests, <1s, no drives required
npm run smoke   # loads the real renderer in Electron -- does it still evaluate?
npm run e2e     # drives the real UI against a sandbox -- does it still work?
```

Each catches what the others cannot:

- **`npm test`** is pure-logic only. It can be entirely green while the app is
  completely broken.
- **`npm run smoke`** loads the real `index.html` in a hidden window and fails on any
  uncaught error, any missing bridged global, or any missing DOM node. It proves the
  renderer *loads*, not that it *works*.
- **`npm run e2e`** builds a throwaway drive tree, points the app at it with the
  `PDC_*` variables, then types in the client box, clicks Search, ticks checkboxes,
  creates projects — and asserts against the files that land on disk. 86 checks. It
  never touches the real `C:\_Clients`, `G:` or `J:`.

The layering is not academic. Moving shared mutable state across module boundaries
produces bugs that load perfectly cleanly and simply write projects to the wrong
drive; only the e2e layer sees those. One real regression during the restructure
passed both `npm test` and the whole e2e suite, and was caught by smoke alone.

### Two testing rules

**Never edit a test's expected value to make it pass.** If behaviour changed on
purpose, change the test and the code in the same commit, and say so. Anything
labelled `QUIRK`, `DEAD BRANCH` or `FROZEN` in the suite is asserting *current*
behaviour deliberately, so that fixing it later shows up as a reviewable diff.

**Prove a new test can fail.** Reintroduce the bug, watch it go red, put it back.
A test that has never failed has not been shown to test anything.

---

## Releasing

**Publishing a GitHub release pushes code onto every workstation.** The app calls
`downloadUpdate()` as soon as an update is available, and `autoInstallOnAppQuit` is
`true` — so it installs when the user closes the app, whether or not they ever click
Install. There is no opt-out and no downgrade path.

`npm run dist` builds locally and does **not** publish. Only `release:draft` uploads,
and only as a *draft* — pressing **Publish** on GitHub is the irreversible step.

| Command | Reaches users? |
|---|---|
| `npm test` / `npm run pack` / `npm run dist` | no |
| `npm run verify:build` | no |
| `npm run release:draft` | no — uploads a **draft** |
| Pressing *Publish release* on GitHub | **yes, everyone, on next app quit** |

### Checklist

**1. Before building**

- [ ] All three test layers green.
- [ ] Version bumped in **both** `package.json` and the `<p>Version x.y.z</p>` line
      in `index.html`. A test enforces that they match.
- [ ] `git status` clean; the change set is what you expect.
- [ ] `config.json` present locally.

**2. Build and verify**

```bash
npm run dist && npm run verify:build
```

`verify:build` opens the real `app.asar` and fails if runtime code is missing, if
dev files leaked in, or if `latest.yml` disagrees with `package.json`. Do not skip
it — the unit tests check what `package.json` *says*; this checks what
electron-builder actually *did*.

> Do not trust `dist/builder-effective-config.yaml` — electron-builder does not
> rewrite it every run. It has been observed nine months stale next to a correct
> `app.asar`.

**3. Smoke test the installed build**

Install `dist/Project_directory_Creation Setup <version>.exe` on a real workstation.
Not `npm start` — that exercises a different file layout and cannot catch a
packaging fault.

- [ ] App launches; version line reads correctly.
- [ ] Client search returns projects in both columns.
- [ ] Create a project (Standard) → appears on C:, copies to G:, sync pair written.
- [ ] Create with DIT and with RPAS → overlay folders present.
- [ ] Quote Directory mode, if the Accounts QT share is reachable.
- [ ] **Copy to G** / **Copy to C** on an unsynced project.
- [ ] **Folders to G** — structure copied, no files.
- [ ] **Create Folder Pairs**, then **Open FreefileSync** → opens without a parse
      error and the pairs point at real directories.
- [ ] Open `C:\Freefilesyncfiles\SyncSettings.ffs_gui` and confirm no
      `<Left>undefined</Left>`.
- [ ] J-drive toggle → headings change, projects list, pairs go to the Jdrive config.

Use a scratch client. Two flows to be careful with:

- **Create New Client posts to the live ESE API** and creates a real record. There is
  no test environment. Skip it, or be prepared to clean up.
- The launch-time FreeFileSync repair rewrites real configs (after a `.bak`).

**4. Publish**

```bash
npm run release:draft
```

Then on GitHub: open the draft, confirm the assets uploaded (`.exe`, `.exe.blockmap`,
`latest.yml`), write the notes, and only then press Publish.

**5. If it goes wrong**

There is no downgrade — electron-updater will not move a user backwards. Recovery is
to **publish a higher version containing the fix**. Keep the previous portable build
(`Project_directory_Creation-<version>-win.exe`) on the share; it runs without
installing and is the fastest way to get someone working again.

---

## Known issues

Ordered by blast radius, not tidiness.

| Severity | Where | What |
|---|---|---|
| **HIGH** | `services/algolia.js`, `services/ese-api.js` | The Algolia app ID, **both** Algolia keys and the ESE Basic token are hardcoded in committed source and shipped inside `app.asar`. One Algolia key has **write** access (`saveObjects`, `clearObjects`). They are in git history, so **rotation is mandatory** — removing them from source is not sufficient. An admin key should not ship in a client at all. |
| MED | `main.js` `whenReady` | `config.json` is read with no error handling; a fresh clone fails silently. See *Running it*. |
| MED | `services/algolia.js` | `require('node-fetch')` is not in `package.json` — it resolves only via a stale transitive v1.7.3. A clean install can break the renderer. Electron 30 has global `fetch`; the require should go. |
| MED | `renderer/major-clients.js` | `JSON.parse` throws on a UTF-8 BOM and the catch falls back to an empty list. `majorClients.json` is hand-edited on the share, so one save from Notepad as "UTF-8 with BOM" routes **every** major client into the wrong bucket, with no visible error. Already fixed on the main-process path; still open here. |
| LOW | `main.js` | `checkForUpdatesAndNotify()` runs twice per launch, so `update-available` can fire twice. |
| LOW | `renderer/state.js` | `selectedDrive` starts empty until the first Search; other code paths still read it before then. |
| INFO | `main.js` | `process.env.ELECTRON_BUILDER_NO_DELTA` is set at *runtime* in the packaged app. It is a build-time variable, so it does nothing. |

### Deliberate deviations

Three places where extracted code is knowingly not a byte-for-byte port of the
original, each proven unobservable by a test and labelled `DEVIATION` in the suite:
`sortProjects` returns a copy rather than sorting in place;
`generateFolderPairsXml` no longer rewrites `project.name` while escaping `&`;
`normaliseProjectName` accepts `null`/`undefined` instead of throwing.
