// Preload for the Google Drive status window.
//
// The window is otherwise script-free and driven by executeJavaScript from the
// main process. The Refresh button is the one thing that has to talk back, so it
// gets a single named function -- not a general ipcRenderer bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdcRefreshApp', () => {
    ipcRenderer.send('drive-status-refresh');
});
