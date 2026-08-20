# main/ — Phase 3

`main.js` (282 lines) splits into:

- `index.js` — app lifecycle and `createWindow`.
- `updater.js` — the `electron-updater` wiring and its IPC channels.
- `ipc/fs-ops.js` — `copy-directory`, `copy-folders-only`.
- `ipc/dialogs.js` — `show-custom-alert`, the copying-progress window, message boxes.

Two things to fix while moving, each in its own commit:

- `main.js:159` calls `ipcRenderer.send` inside a main-process handler, where
  `ipcRenderer` does not exist. The `show-confirm-dialog` channel looks unused.
- Startup is spread across three separate hooks: `app.on('ready')` at `main.js:90`,
  again at `main.js:137` (`createWindow`), and `app.whenReady()` at `main.js:169`,
  which dereferences `mainWindow`. That third block works today only because it is
  registered after `createWindow` and so runs after it — reorder the file and it
  breaks silently. Collapse all three into one ordered startup sequence.

Also note both `main.js:78` and `main.js:177` attach a `did-finish-load` handler to
the same window, from different hooks. Consolidate them at the same time.
