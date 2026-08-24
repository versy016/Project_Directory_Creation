/**
 * Renderer smoke test.
 *
 *   npm run smoke
 *
 * Loads the REAL index.html + script.js in a hidden window with the same
 * webPreferences the app uses, and reports whether the renderer finished
 * evaluating without throwing and still exposes the globals other code depends on.
 *
 * `npm test` cannot catch a broken script.js -- it only exercises src/core. This
 * closes that gap: a bad require, a renamed function, or a top-level throw shows
 * up here in a few seconds instead of after an installer reaches someone's desk.
 *
 * What it does NOT do: it never calls fetchAndIndex*, so no Algolia writes, and it
 * never sends the api-key message, so Google Maps is not loaded. Reading
 * majorClients.json off G: is attempted by script.js at load and is expected to log
 * a console error when the drive is not mounted -- that is reported, not failed on.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

app.disableHardwareAcceleration();

/**
 * Globals the rest of the system reaches for. If script.js throws partway through
 * evaluation these vanish, and the failure is otherwise silent.
 *
 *   fetchAndIndex*   -- invoked by main.js on did-finish-load
 *   refreshApp       -- onclick in index.html
 *   createProject / copyProject / copyFoldersOnly
 *                    -- referenced from onclick attributes in generated table rows,
 *                       so they must stay on window, not be scoped into a module
 */
const REQUIRED_GLOBALS = [
  'fetchAndIndexClients',
  'fetchAndIndexTenders',
  'fetchAndIndexContacts',
  'refreshApp',
  'createProject',
  'copyProject',
  'copyFoldersOnly',
];

const consoleErrors = [];

function report(problems, notes) {
  console.log('');
  for (const note of notes) {
    console.log(`  ok    ${note}`);
  }
  for (const line of consoleErrors) {
    console.log(`  note  renderer console.error: ${line}`);
  }
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  console.log('');

  if (problems.length) {
    console.log(`  ${problems.length} problem(s). The renderer is broken.\n`);
    app.exit(1);
    return;
  }
  console.log('  Renderer smoke test passed.\n');
  app.exit(0);
}

app.on('ready', () => {
  // Must mirror the app's own webPreferences exactly -- the point of this test is
  // that the renderer works under real isolation, and a laxer config here would
  // hide precisely the failures it exists to catch. Note this uses the APP's
  // preload, not a test one: with contextIsolation there is only one preload, and
  // the app's IS the renderer now.
  const win = new BrowserWindow({
    show: false,
    width: 1500,
    height: 1000,
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // A throw inside the preload is now the failure mode that matters: it takes the
  // entire renderer with it, and the page still loads looking fine.
  win.webContents.on('preload-error', (event, preloadPath, error) => {
    console.log(`\n  FAIL  preload threw: ${error && error.message}\n`);
    app.exit(1);
  });

  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 3) {
      consoleErrors.push(message.split('\n')[0].slice(0, 160));
    }
  });

  win.webContents.on('render-process-gone', (event, details) => {
    console.log(`\n  FAIL  renderer process gone: ${details.reason}\n`);
    app.exit(1);
  });

  win.webContents.on('did-fail-load', (event, code, description) => {
    console.log(`\n  FAIL  page failed to load: ${description} (${code})\n`);
    app.exit(1);
  });

  win.webContents.on('did-finish-load', async () => {
    // Let deferred DOMContentLoaded handlers and microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const problems = [];
    const notes = [];

    try {
      notes.push('preload evaluated without throwing');

      const missing = await win.webContents.executeJavaScript(
        `(${JSON.stringify(REQUIRED_GLOBALS)}).filter((name) => typeof window[name] !== 'function')`
      );
      if (missing.length) {
        problems.push(`missing global function(s): ${missing.join(', ')}`);
      } else {
        notes.push(`all ${REQUIRED_GLOBALS.length} required globals present`);
      }

      // Report which roots this run resolved. With the PDC_* variables set this is
      // the proof that the app is pointed at a sandbox and not the real drives.
      // Read from this process rather than the page: the page has no `require`
      // any more, and the main process reads the same environment.
      const { roots } = require(path.join(PROJECT_ROOT, 'src', 'config', 'roots'));
      notes.push(`roots.localClients = ${roots.localClients}`);
      notes.push(`roots.sharedBase   = ${roots.sharedBase}`);
      notes.push(`roots.ffsConfigDir = ${roots.ffsConfigDir}`);

      // The isolation itself, checked at runtime rather than by reading config.
      // A page that can still reach Node has full filesystem access, and nothing
      // else in the suite would notice.
      const escapes = await win.webContents.executeJavaScript(
        `[
           typeof require,
           typeof process,
           typeof module,
           typeof globalThis.electron,
         ]`
      );
      const reachable = ['require', 'process', 'module', 'electron'].filter(
        (name, i) => escapes[i] !== 'undefined'
      );
      if (reachable.length) {
        problems.push(`the page can still reach Node: ${reachable.join(', ')}`);
      } else {
        notes.push('page has no require / process / module / electron');
      }

      // The two tables and the sync column must exist for anything to render.
      const missingNodes = await win.webContents.executeJavaScript(
        `['cDriveProjects','gDriveProjects','directionColumn','clientInput','btnSubmit',
           'projectSearchInput','reload','mainForm','nameSourceMode','enterManually','SearchProject']
           .filter((id) => !document.getElementById(id))`
      );
      if (missingNodes.length) {
        problems.push(`missing DOM node(s): ${missingNodes.join(', ')}`);
      } else {
        notes.push('key DOM nodes resolved');
      }
    } catch (error) {
      problems.push(`could not query the renderer: ${error.message}`);
    }

    report(problems, notes);
  });

  win.loadFile(path.join(PROJECT_ROOT, 'index.html'));
});

setTimeout(() => {
  console.log('\n  FAIL  timed out waiting for the renderer\n');
  app.exit(2);
}, 40000);
