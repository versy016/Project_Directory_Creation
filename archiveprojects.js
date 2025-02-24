// const { app, BrowserWindow, ipcMain } = require('electron');
// const fr = require('fs-extra');
// const path = require('path');
// const archiver = require('archiver');

// const G_DRIVE_PATH = 'G:/Shared drives/ES Cloud/_Clients/WSP Australia';
// const THREE_MONTHS_AGO = new Date();
// THREE_MONTHS_AGO.setMonth(THREE_MONTHS_AGO.getMonth() - 3);

// function createWindow() {
//   const win = new BrowserWindow({
//     width: 800,
//     height: 600,
//     webPreferences: {
//       nodeIntegration: true,
//       contextIsolation: false, // Set to true if using preload script
//     },
//   });

//   win.loadFile('index.html');
// }


// // Listen for the "archive-files" event from the renderer
// ipcMain.on('archive-files', (event) => {
//   processClientFolders().then(() => {
//     event.reply('archive-done', 'Archiving process completed.');
//   }).catch((err) => {
//     event.reply('archive-error', err.message);
//   });
// });

// // Initialize the window when the app is ready
// app.whenReady().then(() => {
//   createWindow();
// });

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit();
//   }
// });
