# Release process

## The hazard

The update chain has no brakes in it. Once a GitHub release is public:

- `main.js:18-25` — on `update-available`, the app immediately calls `downloadUpdate()`.
  (`autoDownload = false` at `main.js:12` is overridden by that explicit call.)
- `main.js:14` — `autoInstallOnAppQuit = true`, so the update installs when the user
  closes the app, whether or not they ever click **Install Update**.

So publishing is not "making a build available". It is pushing code onto every
workstation, and the user does not have to agree to it. Everything below exists to
put a deliberate gap between "I built something" and "everyone is running it".

## What changed

`npm run dist` used to carry `--publish always` — building *was* releasing. It no
longer does.

| Command | What it does | Reaches users? |
|---|---|---|
| `npm test` | 107 unit + config tests, ~0.2s | no |
| `npm run pack` | unpacked build, no installer | no |
| `npm run dist` | runs tests, then builds the installer locally | **no** |
| `npm run verify:build` | opens the built `app.asar` and checks its contents | no |
| `npm run release:draft` | runs tests, builds, uploads as a **draft** GitHub release | **no — until you press Publish** |
| Pressing *Publish release* on GitHub | — | **yes, everyone, on next app quit** |

`build.publish.releaseType` is now pinned to `draft`, and a test fails if anyone
changes it or adds `--publish always` to another script.

## Two findings from auditing the pipeline

**1. `"!src/"` was excluding the entire new source tree from the installer.**
It sat in `build.files` (probably left over from a TypeScript layout that never
existed). Every test would have passed, the app would have run perfectly from
`npm start`, and the *installed* copy would have crashed on the first
`require('./src/core/paths')` as soon as Phase 2 landed. Removed, and now guarded by
`tests/release/packaging.test.js` plus `scripts/verify-build.js`.

**2. The `publish` block in `package.json` was being ignored.**
It sat at the root of `package.json`, but electron-builder only reads
`build.publish`. Confirmed against `dist/builder-effective-config.yaml` as written
by the build that produced the shipped 1.1.5 — it contains no `publish` key at all.
So `releaseType: "release"` was never in effect; electron-builder inferred the
GitHub provider from the `repository` field and used its default, which is `draft`.
Now moved into `build.publish` and pinned to `draft` explicitly.

> **Do not trust `dist/builder-effective-config.yaml` as a current view.**
> electron-builder does not rewrite it on every run — after a local rebuild it was
> still 9 months stale while the freshly built `app.asar` was correct. Use
> `npm run verify:build`, which reads the actual archive.

**Worth confirming on your side:** if releases have been reaching users
automatically, someone or something has been publishing those drafts. Check whether
recent releases at `github.com/versy016/project_directory_creation/releases` were
published by hand, or whether a CI workflow or a GitHub setting is promoting them.
If something is auto-publishing drafts, the draft default is not the safety net it
looks like, and that needs closing before the next release.

## Release checklist

### 1. Before building

- [ ] `npm test` — all green.
- [ ] Version bumped in **both** `package.json` and the `<p>Version x.y.z</p>` line
      in `index.html`. A test enforces that they match.
- [ ] `git status` clean; the change set is what you expect.
- [ ] `config.json` exists locally. It is gitignored, so a fresh clone does **not**
      have it — and `main.js:174` reads it with no error handling, which silently
      kills the `directory-existence` and `api-key` messages if it is absent.

### 2. Build and verify the artifact

```bash
npm run dist && npm run verify:build
```

`verify:build` opens the real `app.asar` and fails if runtime code is missing, if
dev files leaked in, if the build is older than your sources, or if the version in
`latest.yml` disagrees with `package.json`. Do not skip it — the config tests check
what `package.json` *says*, this checks what electron-builder actually *did*.

### 3. Smoke test the installed build

Install `dist/Project_directory_Creation Setup <version>.exe` on a real workstation.
Not `npm start` — that exercises a different file layout and cannot catch a
packaging fault.

- [ ] App launches; version line reads correctly.
- [ ] Client search returns projects in both columns.
- [ ] Create a project (Standard) → appears on C:, copies to G:, sync pair written.
- [ ] Create a project with DIT and with RPAS → overlay folders present.
- [ ] Quote Directory mode, if the Accounts QT share is reachable.
- [ ] **Copy to G** and **Copy to C** on an unsynced project.
- [ ] **Folders to G** — structure copied, no files.
- [ ] **Create Folder Pairs**, then **Open FreefileSync** → the `.ffs_gui` opens
      without a parse error and the pairs point at real directories.
- [ ] Open `C:\Freefilesyncfiles\SyncSettings.ffs_gui` in a text editor and confirm
      no `<Left>undefined</Left>` (see bug #1 in `REFACTOR.md` — reachable today by
      choosing "Sync G To C" on the new-project form).
- [ ] J-drive toggle → headings change, projects list, pairs go to the Jdrive config.

Use a scratch client folder for these. Two flows to be careful with:

- **Create New Client** posts to the live ESE API and creates a real record. There
  is no test environment. Either skip it or be prepared to clean up.
- Project creation briefly creates and then deletes a dated folder inside the
  **shared** `_PDIR_Defaults` template (`script.js:1330-1348`, `1449-1464`). Two
  people releasing at once can interfere with each other.

### 4. Publish

```bash
npm run release:draft
```

Then on GitHub: open the draft, confirm the assets uploaded
(`.exe`, `.exe.blockmap`, `latest.yml`), write release notes, and **only then**
press Publish.

- [ ] Confirm on a test machine that it picks up the update and installs on quit.
- [ ] Tell the team a release is going out.

### 5. If it goes wrong

There is no downgrade path — electron-updater will not move a user backwards. To
recover you must **publish a higher version containing the fix**. So:

- [ ] Keep the previous portable build (`Project_directory_Creation-<version>-win.exe`)
      on the share. It runs without installing and is the fastest way to get someone
      working again.
- [ ] Roll forward, never back. Bump the patch version and re-run this checklist.

## Worth doing next

**A pilot channel.** Right now every release is all-or-nothing. `electron-updater`
supports prereleases: publish `1.1.6-beta.1` as a GitHub *prerelease*, and only
clients with `autoUpdater.allowPrerelease = true` pick it up. Gate that flag on a
marker file (say `C:\Freefilesyncfiles\pdc-beta.flag`) and you can put one or two
people on the beta channel without a separate build.

That needs a change to `main.js`, which is why it is not done here — it alters the
update mechanism itself and deserves its own carefully-verified release.

**Dead line to remove.** `main.js:87` sets `process.env.ELECTRON_BUILDER_NO_DELTA`
at *runtime*, in the packaged app. It is a build-time variable, so it does nothing —
`.exe.blockmap` is still generated and delta updates are still active. Either set it
properly in the build script or drop the line.
