const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path'); // This line imports the 'path' module
let copyingInProgressWindow = null;
const fs = require('fs-extra'); // Assuming fs-extra is required as fsExtra
let mainWindow; 
const { autoUpdater } = require('electron-updater');
const { roots } = require('./src/config/roots');
const {
  ensureGoogleDrive,
  watchForDrive,
  isDriveConnected,
  notConnectedHeadline,
} = require('./src/main/google-drive');
const driveStatus = require('./src/main/drive-status-window');
const { repairSyncConfigs, describeRepairs } = require('./src/services/ffs-repair-service');
const { showAlert } = require('./src/main/alert-modal');
autoUpdater.logger = require("electron-log");

autoUpdater.logger.transports.console.level = "info";

autoUpdater.logger.transports.file.level = "info";
autoUpdater.autoDownload = false; // Example of another option
autoUpdater.disableWebInstaller = true; // Disable web installer
autoUpdater.autoInstallOnAppQuit = true;
app.disableHardwareAcceleration();


autoUpdater.on('update-available', () => {
  console.log('Update available! Downloading...');
  // This triggers the actual download
  autoUpdater.downloadUpdate();

  // Also let the renderer know that an update was found
  mainWindow.webContents.send('update-available');
});

autoUpdater.on('download-progress', (progress) => {
  // progress has properties like total, transferred, percent, bytesPerSecond
  mainWindow.webContents.send('download-progress', progress);
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
  mainWindow.webContents.send('update-error', err.message);
});

// electron-updater emits 'update-downloaded' with an UpdateInfo object
autoUpdater.on('update-downloaded', (info) => {
  const { version, releaseNotes, releaseName } = info || {};
  mainWindow.webContents.send('update-downloaded', {
    version,
    releaseNotes,
    releaseName
  });
});

// main.js
ipcMain.on('install-update', () => {
  console.log('User chose to install the update.');
  autoUpdater.quitAndInstall();
});


autoUpdater.on('update-not-available', () => {
  console.log('No updates available');
});





function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1000,
    webPreferences: {
      // The page gets no Node and no require. Everything the renderer needs is
      // loaded by preload.js, which hands the page a named list of functions via
      // contextBridge. See the header comment in preload.js before changing this.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for the preload itself to keep Node -- Electron sandboxes
      // renderers by default, which would strip `require` from the preload too.
      sandbox: false,
      webSecurity: true,
    }
    });
 
  mainWindow.loadFile('index.html'); // Load your HTML file
   mainWindow.on('ready-to-show', () => {
    autoUpdater.checkForUpdatesAndNotify();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript('window.fetchAndIndexClients()');
    mainWindow.webContents.executeJavaScript('window.fetchAndIndexTenders()');
    mainWindow.webContents.executeJavaScript('window.fetchAndIndexContacts()');
 
  });
}

// or to forcibly skip blockmap-based updates:
process.env.ELECTRON_BUILDER_NO_DELTA = '1';


app.on('ready', async () => {
    if (process.env.NODE_ENV === 'development') {
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
    } else {
        autoUpdater.updateConfigPath = path.join(__dirname, 'app-update.yml');
    }
    autoUpdater.checkForUpdatesAndNotify();
 /*
  const targetDir = 'C:\\Freefilesyncfiles'; // Target directory where files are stored
  await fs.ensureDir(targetDir); // Ensure the directory exists

  const appDir = path.dirname(app.getPath('exe')); // Get the directory where the app is running
  const filesToReplace = ['SyncSettings.ffs_gui', 'SyncSettings_Quotes.ffs_gui']; // Force replace these
  const filesToKeep = ['SyncSettingsJdrive.ffs_gui']; // Keep this file unchanged

  // **Replace specified files**
  for (const file of filesToReplace) {
    const sourcePath = path.join(appDir, file);
    const targetPath = path.join(targetDir, file);
    try {
      // Always replace these files, even if they exist
      await fs.copy(sourcePath, targetPath, { overwrite: true });
      console.log(`✅ Replaced: ${file}`);
    } catch (error) {
      console.error(`❌ Failed to replace ${file}:`, error);
    }
  }

  // **Keep other files unchanged**
  for (const file of filesToKeep) {
    const sourcePath = path.join(appDir, file);
    const targetPath = path.join(targetDir, file);
    try {
      if (!(await fs.pathExists(targetPath))) {
        await fs.copy(sourcePath, targetPath);
        console.log(`✅ Copied (first time): ${file}`);
      } else {
        console.log(`🔄 Skipping ${file}, already exists.`);
      }
    } catch (error) {
      console.error(`❌ Failed to copy ${file}:`, error);
    }
  }
  */
});


app.on('ready', createWindow);

ipcMain.on('show-dialog', (event, args) => {
  dialog.showMessageBox(mainWindow, {
    type: args.type || 'info',
    title: 'Update Available',
    message: args.message,
    buttons: ['OK']
  });

});

ipcMain.on('show-confirm-dialog', (event, args) => {
  dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Install Update',
    message: args.message,
    buttons: ['Restart', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).then(result => {
    if (result.response === 0) { // Restart button
      ipcRenderer.send('restart_app');
    }
  });
});


ipcMain.on('refresh-app', (event) => {
    mainWindow.reload();
});

/**
 * Nearly everything this app does reads or writes the shared drive. When Google
 * Drive for Desktop is not running the drive is simply absent, and the symptom is
 * a scatter of "client not found" and copy failures rather than one clear cause.
 *
 * The status window opens the moment a missing drive is detected -- BEFORE the
 * launch attempt -- so the user is told immediately and then watches progress,
 * rather than staring at nothing for thirty seconds and getting a complaint.
 */
function checkGoogleDrive() {
  const driveRoot = roots.sharedBase;

  if (isDriveConnected(driveRoot)) {
    console.log('Google Drive: already-connected');
    return;
  }

  const headline = notConnectedHeadline(driveRoot);
  driveStatus.open({ parent: mainWindow, headline });

  ensureGoogleDrive({
    driveRoot,
    onStatus: ({ state, executable }) => {
      if (state === 'launching') {
        console.log(`Google Drive: launching ${executable}`);
        driveStatus.update({
          headline,
          detail: '',
          status: 'Starting Google Drive for Desktop…',
          busy: true,
        });
      } else if (state === 'waiting') {
        driveStatus.update({
          headline,
          detail: '',
          status: 'Connecting to Google Drive…',
          busy: true,
        });
      }
    },
  })
    .then(async (result) => {
      console.log(`Google Drive: ${result.outcome}`);

      if (!result.connected) {
        // Say what went wrong, but keep watching. Signing in through the browser
        // takes as long as it takes, and closing the notice on a timer would
        // leave a stale warning with no sign of when the drive finally arrives.
        driveStatus.update({
          headline,
          detail: result.message,
          status: '',
          busy: false,
        });

        const appeared = await watchForDrive({
          driveRoot,
          shouldStop: () => !driveStatus.isOpen(),
        });

        if (!appeared) {
          return; // The user dismissed the notice.
        }
      }

      announceConnected(driveRoot);
    })
    .catch((error) => {
      console.error('Google Drive check failed:', error);
      driveStatus.update({
        headline,
        detail: `The Google Drive check failed unexpectedly.\n\n(${error.message})`,
        status: '',
        busy: false,
      });
    });
}

/**
 * The drive is up. The window stays open rather than closing silently, because
 * the app still needs reloading: `directory-existence` was answered "no" for this
 * page, so the Quote Directory option is hidden until the renderer asks again.
 */
function announceConnected(driveRoot) {
  console.log('Google Drive: connected');
  driveStatus.update({
    headline: `G drive connected (${driveRoot})`,
    detail: 'Refresh to load your clients, projects and quotes.',
    status: '',
    busy: false,
    connected: true,
  });
}

// The Refresh button in the status window.
ipcMain.on('drive-status-refresh', () => {
  driveStatus.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
});

/**
 * Repair FreeFileSync folder pairs that were switched to the database-detection
 * form, which this app cannot read.
 *
 * Runs at launch because the damage is invisible until someone notices that no
 * project shows as synced any more, and by then they have usually already made
 * decisions based on that. Originals are backed up alongside before anything is
 * written -- see services/ffs-repair-service.
 */
function checkSyncConfigs() {
  let report;

  try {
    report = repairSyncConfigs();
  } catch (error) {
    console.error('Folder pair scan failed:', error);
    return;
  }

  console.log(
    `Folder pairs: scanned ${report.scanned.length} config(s), ` +
      `repaired ${report.repaired.reduce((n, entry) => n + entry.pairs.length, 0)} pair(s)`
  );

  const message = describeRepairs(report);
  if (message) {
    createAlertModal(message);
  }
}

app.whenReady().then(() => {
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const apiKey = config.GOOGLE_MAPS_API_KEY;

  mainWindow.webContents.on('did-finish-load', () => {
      // BUG FIX: this was evaluated ONCE at startup and captured in the closure,
      // so every reload re-sent the original answer. If the app started before
      // Google Drive was up, the Quote Directory option stayed hidden for the
      // whole session and Refresh could not bring it back. Checked per load now.
      const quotesReachable = fs.existsSync(roots.sharedQuotes);

      mainWindow.webContents.send('directory-existence', quotesReachable);
      mainWindow.webContents.send('api-key', apiKey);

      checkGoogleDrive();
      checkSyncConfigs();
  });

});ipcMain.handle('show-message-box', async (event, options) => {
  const response = await dialog.showMessageBox(options);
  return response;
});
ipcMain.handle('copy-directory', async (event, { projectName, fromPath, toPath }) => {
    const sourcePath = path.join(fromPath, projectName);
    const destinationPath = path.join(toPath, projectName);
    try {
        console.log(`Starting to copy project '${projectName}' from '${sourcePath}' to '${destinationPath}'...`);
        // Ensure the parent directory exists
        await fs.ensureDir(path.dirname(destinationPath));
        await fs.copy(sourcePath, destinationPath);
        console.log(`Project '${projectName}' has been successfully copied.`);
    } catch (error) {
        console.error(`Error copying project '${projectName}':`, error);
        throw error; // Rethrow the error to be caught in the renderer process
    }
});
// Copy only the folder structure (no files)
ipcMain.handle('copy-folders-only', async (event, { projectName, fromPath, toPath }) => {
    const sourcePath = path.join(fromPath, projectName);
    const destinationPath = path.join(toPath, projectName);
    try {
        console.log(`Starting folder-structure copy for '${projectName}' from '${sourcePath}' to '${destinationPath}'...`);
        await fs.ensureDir(path.dirname(destinationPath));
        // Copy directories only; exclude files via filter
        await fs.copy(sourcePath, destinationPath, {
            filter: (src) => {
                try {
                    return fs.lstatSync(src).isDirectory();
                } catch (e) {
                    return false;
                }
            }
        });
        console.log(`Folder structure for '${projectName}' copied successfully.`);
    } catch (error) {
        console.error(`Error copying folder structure for '${projectName}':`, error);
        throw error;
    }
});
ipcMain.handle('show-copying-in-progress', async () => {
  // Create a new BrowserWindow to show copying progress
  if (!copyingInProgressWindow) {
    // Static text, no scripts -- so it has no business holding Node.
    copyingInProgressWindow = new BrowserWindow({
      width: 400,
      height: 200,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    copyingInProgressWindow.loadURL('data:text/html,<h3>Copying in progress...</h3>');
    copyingInProgressWindow.on('closed', () => {
      copyingInProgressWindow = null;
    });
  }
});

ipcMain.handle('close-copying-in-progress', () => {
  // Close the copying progress window if it's open
  if (copyingInProgressWindow) {
    copyingInProgressWindow.close();
    copyingInProgressWindow = null;
  }
});
ipcMain.on('focus-fix', () => {
    mainWindow.blur();
    mainWindow.focus();
});
ipcMain.on('show-custom-alert', (event, message) => {
    createAlertModal(message);
});
// The alert modal lives in src/main/alert-modal: it measures its own content, so
// the multi-line folder-pair report is no longer clipped by a fixed height.
function createAlertModal(message) {
  showAlert(message, { parent: mainWindow });
}
