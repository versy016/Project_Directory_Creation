'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');

/**
 * The Google Drive status window.
 *
 * A one-shot alert was wrong for this: nothing appeared for thirty seconds while
 * the drive was polled, so from the user's side the app just sat there and then
 * complained. This window opens the INSTANT a missing drive is detected, shows
 * what is happening while it happens, and settles into either silence (connected)
 * or an actionable message (still not connected).
 *
 * It carries no Node and no preload. The page is static markup; the main process
 * drives it with executeJavaScript, which runs in the page's main world and needs
 * no bridge. Keeping it script-free is why it can stay fully isolated.
 */

const PAGE = `
<style>
  :root { color-scheme: light; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0; padding: 28px 30px; color: #333; background: #fff;
    -webkit-user-select: none; user-select: none;
  }
  h2 { margin: 0 0 14px 0; font-size: 1.05em; color: #111; }
  h2.connected { color: #1a7f37; }
  #detail { margin: 0; font-size: 0.9em; line-height: 1.5; color: #444; white-space: pre-wrap; }
  #progress { display: flex; align-items: center; gap: 10px; margin-top: 18px; font-size: 0.9em; color: #555; }
  .spinner {
    width: 18px; height: 18px; flex: none;
    border: 2px solid #d7d7d7; border-top-color: #3F51B5; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #actions { margin-top: 22px; display: none; }
  button {
    border: none; background: #0078d7; color: #fff; padding: 7px 14px;
    border-radius: 5px; font-size: 0.9em; cursor: pointer;
  }
  button:hover { background: #005fa3; }
</style>
<body>
  <h2 id="headline"></h2>
  <p id="detail"></p>
  <div id="progress"><div class="spinner"></div><span id="status"></span></div>
  <div id="actions">
    <button id="refreshButton" onclick="window.pdcRefreshApp()">Refresh</button>
    <button id="closeButton" onclick="window.close()">OK</button>
  </div>
</body>
`;

const COMPACT_HEIGHT = 165;

let statusWindow = null;
let ready = null;

function open({ parent, headline }) {
    if (statusWindow && !statusWindow.isDestroyed()) {
        return;
    }

    statusWindow = new BrowserWindow({
        width: 480,
        // Sized for the spinner state; grown in update() when the longer failure
        // text arrives, so neither state is padded with dead space.
        height: COMPACT_HEIGHT,
        parent,
        // Not modal on purpose. Connecting can take half a minute, and locking the
        // user out of the whole app for that long is worse than the problem --
        // plenty of the app still works without the shared drive.
        modal: false,
        alwaysOnTop: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        frame: false,
        webPreferences: {
            // One named function, so the Refresh button can reach the main process.
            preload: path.join(__dirname, 'drive-status-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    });

    statusWindow.on('closed', () => {
        statusWindow = null;
        ready = null;
    });

    ready = new Promise((resolve) => {
        statusWindow.webContents.once('did-finish-load', resolve);
    });

    statusWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(PAGE)}`);
    statusWindow.once('ready-to-show', () => statusWindow.show());

    update({ headline, detail: '', status: 'Checking Google Drive…', busy: true });
}

/**
 * Values are injected as JSON, so nothing in a path or error can break the page.
 *
 * @param {object} args
 * @param {boolean} [args.busy]      show the spinner and hide the buttons
 * @param {boolean} [args.connected] green headline, and offer Refresh
 */
async function update({ headline, detail, status, busy, connected = false }) {
    if (!statusWindow || statusWindow.isDestroyed()) {
        return;
    }

    await ready;
    if (!statusWindow || statusWindow.isDestroyed()) {
        return;
    }

    const script = `
        (() => {
            const set = (id, value) => {
                if (value !== undefined) document.getElementById(id).textContent = value;
            };
            set('headline', ${JSON.stringify(headline)});
            set('detail', ${JSON.stringify(detail)});
            set('status', ${JSON.stringify(status)});
            document.getElementById('headline').classList.toggle('connected', ${connected});
            document.getElementById('progress').style.display = ${busy ? "'flex'" : "'none'"};
            document.getElementById('actions').style.display = ${busy ? "'none'" : "'block'"};

            // Refresh only makes sense once the drive is actually there; until
            // then the only useful action is to dismiss the notice.
            document.getElementById('refreshButton').style.display =
                ${connected ? "'inline-block'" : "'none'"};
            document.getElementById('closeButton').style.display =
                ${connected ? "'none'" : "'inline-block'"};

            // Measured, not estimated: guessing at line wrapping left the failure
            // text with a scrollbar.
            const last = document.body.lastElementChild;
            return Math.ceil(last.getBoundingClientRect().bottom) + 28;
        })();
    `;

    try {
        const contentHeight = await statusWindow.webContents.executeJavaScript(script);

        // Content size, not window size -- the measurement above is of the page.
        const wanted = Math.min(420, Math.max(COMPACT_HEIGHT, contentHeight || COMPACT_HEIGHT));
        const [width, current] = statusWindow.getContentSize();
        if (Math.abs(current - wanted) > 2) {
            statusWindow.setContentSize(width, wanted);
            statusWindow.center();
        }
    } catch (error) {
        // The user can close the window at any point; losing the race is fine.
        console.error('Drive status update failed:', error);
    }
}

/** Is the notice still on screen? Drives the watcher's stop condition. */
function isOpen() {
    return Boolean(statusWindow && !statusWindow.isDestroyed());
}

function close() {
    if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.close();
    }
    statusWindow = null;
    ready = null;
}

module.exports = { open, update, close, isOpen };
