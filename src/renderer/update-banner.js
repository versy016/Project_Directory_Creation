'use strict';

const { ipcRenderer } = require('electron');

/**
 * The auto-updater banner: availability notice, download progress, and the
 * Install Update button.
 *
 * BEHAVIOUR PRESERVED (bug #11): script.js registered TWO separate handlers for
 * 'update-available' -- one raising a native alert, one showing the in-page
 * banner. Both fire, so the user gets a modal *and* a banner. Kept as-is; the
 * fix is a separate commit.
 */
function initUpdateBanner() {
    // 1a) Native alert (the first of the two original handlers)
    ipcRenderer.on('update-available', () => {
        ipcRenderer.send('show-custom-alert', 'A new update is available. Downloading now...');
    });

    // 1b) In-page banner (the second)
    ipcRenderer.on('update-available', () => {
        document.getElementById('updateContainer').style.display = 'block';
        document.getElementById('updateMessage').textContent =
            'A new update is available. Downloading now...';

        const progressBar = document.getElementById('updateProgressBar');
        progressBar.value = 0;
        progressBar.style.display = 'inline';
    });

    // 2) Download progress
    ipcRenderer.on('download-progress', (event, progressObj) => {
        const progressBar = document.getElementById('updateProgressBar');
        progressBar.value = progressObj.percent;

        document.getElementById('updateMessage').textContent =
            `Downloading update... ${progressObj.percent.toFixed(1)}% complete`;
    });

    // 3) Update downloaded
    ipcRenderer.on('update-downloaded', (event, payload = {}) => {
        const { version, releaseName } = payload;
        const label = version || releaseName || 'new version';

        const msgEl = document.getElementById('updateMessage');
        if (msgEl) {
            msgEl.textContent = `Update "${label}" is downloaded. Click "Install Update" to proceed.`;
        }

        const progressBar = document.getElementById('updateProgressBar');
        if (progressBar) progressBar.style.display = 'none';

        const installBtn = document.getElementById('installUpdateButton');
        if (installBtn) installBtn.style.display = 'inline';
    });

    // 4) Install
    document.getElementById('installUpdateButton').addEventListener('click', () => {
        ipcRenderer.send('install-update');
    });
}

/**
 * Called from an inline onclick in index.html, so it has to reach window.
 */
function refreshApp() {
    ipcRenderer.send('refresh-app');
}

module.exports = { initUpdateBanner, refreshApp };
