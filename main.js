const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path'); // This line imports the 'path' module
let copyingInProgressWindow = null;
const fs = require('fs-extra'); // Assuming fs-extra is required as fsExtra
let mainWindow; 
const { autoUpdater } = require('electron-updater');
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

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    // Optionally notify the user of an impending update
  //autoUpdater.quitAndInstall();  // This will quit the app and install the update
   mainWindow.webContents.send('update-downloaded', {
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
        nodeIntegration: true,
        contextIsolation: false, 
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

app.whenReady().then(() => {
  const dirPath = 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients';
  const exists = fs.existsSync(dirPath);

  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const apiKey = config.GOOGLE_MAPS_API_KEY;

  mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('directory-existence', exists);
      mainWindow.webContents.send('api-key', apiKey);
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
        await fs.copy(sourcePath, destinationPath);
        console.log(`Project '${projectName}' has been successfully copied.`);
    } catch (error) {
        console.error(`Error copying project '${projectName}':`, error);
        throw error; // Rethrow the error to be caught in the renderer process
    }
});
ipcMain.handle('show-copying-in-progress', async () => {
  // Create a new BrowserWindow to show copying progress
  if (!copyingInProgressWindow) {
    copyingInProgressWindow = new BrowserWindow({
      width: 400,
      height: 200,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
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
function createAlertModal(message) {
  let modal = new BrowserWindow({
    width: 400,
    height: 200,
    parent: mainWindow, // This makes it a modal window.
    modal: true,
    show: false,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
 const modalContent = `
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 30px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: #333;
            }
            h2 {
                margin: 0 0 20px 0;
                font-size: 1.1em;
                font-weight: bold;
                color: black;
            }
            #closeButton {
                border: none;
                background-color: #0078d7;
                color: white;
                padding: 6px 10px;
                margin-top: 20px;
                border-radius: 5px;
                font-size: 0.9em;
                cursor: pointer;
                outline: none;
            }
            #closeButton:hover {
                background-color: #005fa3;
            }
            #closeButton:active {
                background-color: #004c87;
            }
        </style>
        <body>
            <h2>${message}</h2>
            <button id="closeButton" onclick="window.close();">OK</button>
        </body>
    `;


 modal.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(modalContent)}`);
    modal.once('ready-to-show', () => {
        modal.show();
    });

  // Handle window closed
  modal.on('closed', () => {
    modal = null;
  });
}