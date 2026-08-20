'use strict';

const { BrowserWindow } = require('electron');

/**
 * The app's alert modal.
 *
 * Most callers pass a single sentence ("Project created successfully."), but the
 * folder-pair repair report is a multi-line list that can name a dozen projects.
 * The old fixed 200px window clipped anything past a couple of lines, so the
 * height is measured from the rendered content and long messages scroll.
 *
 * No Node, no preload: the page is static and the main process drives it with
 * executeJavaScript, which is why it can run fully isolated.
 */

const PAGE = `
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; }
  /* border-box is load-bearing: with content-box, height:100% plus the padding
     below makes the body overflow by exactly the padding, which put a scrollbar
     on every alert and pushed the OK button off the bottom edge. */
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0; padding: 26px 30px; color: #333; background: #fff;
    display: flex; flex-direction: column;
    -webkit-user-select: none; user-select: none;
  }
  #message {
    margin: 0; font-size: 1em; color: #111; white-space: pre-wrap;
    overflow-y: auto; flex: 1 1 auto; line-height: 1.5;
  }
  /* A single sentence reads better centred; a list has to be left-aligned. */
  body.compact { align-items: center; justify-content: center; }
  body.compact #message { text-align: center; font-weight: bold; flex: 0 0 auto; }
  #actions { flex: 0 0 auto; padding-top: 18px; }
  button {
    border: none; background: #0078d7; color: #fff; padding: 7px 14px;
    border-radius: 5px; font-size: 0.9em; cursor: pointer;
  }
  button:hover { background: #005fa3; }
</style>
<body>
  <p id="message"></p>
  <div id="actions"><button id="closeButton" onclick="window.close()">OK</button></div>
</body>
`;

const MIN_HEIGHT = 170;
const MAX_HEIGHT = 620;

function showAlert(message, { parent } = {}) {
    const text = String(message == null ? '' : message);
    const compact = !text.includes('\n');

    const modal = new BrowserWindow({
        width: compact ? 420 : 560,
        height: MIN_HEIGHT,
        parent,
        modal: Boolean(parent),
        show: false,
        frame: false,
        resizable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    modal.webContents.once('did-finish-load', async () => {
        try {
            // The text is passed as JSON and assigned to textContent, so nothing in
            // a client name, a path or an error message can break out into markup.
            const contentHeight = await modal.webContents.executeJavaScript(`
                (() => {
                    document.body.classList.toggle('compact', ${compact});
                    const message = document.getElementById('message');
                    message.textContent = ${JSON.stringify(text)};

                    // Measuring this needs care. #message is both flex:1 and the
                    // scroll container, so document.body.scrollHeight just reports
                    // the current viewport (message clipped behind a scrollbar),
                    // while adding up the parts underestimates the flex gaps and
                    // left the OK button hanging off the bottom edge.
                    //
                    // So the constraint is lifted, the natural height read, and the
                    // styles restored -- exact, and no magic padding constants.
                    const flex = message.style.flex;
                    const overflow = message.style.overflow;
                    message.style.flex = '0 0 auto';
                    message.style.overflow = 'visible';

                    const natural = Math.ceil(document.body.scrollHeight);

                    message.style.flex = flex;
                    message.style.overflow = overflow;
                    return natural;
                })();
            `);

            // setContentSize, not setSize: the measurement is of the web content,
            // and setSize means the whole window. The difference is small enough
            // to look like a rounding error and big enough to clip the button.
            const [width] = modal.getContentSize();
            modal.setContentSize(
                width,
                Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight))
            );

            // Then converge. A single measurement is taken while the window is
            // still at its minimum height, and layout under a flex column does not
            // always report the final wrapped height first time -- the last line
            // kept ending up behind a scrollbar. Growing by the measured shortfall
            // and re-checking settles it in one or two passes.
            for (let pass = 0; pass < 3; pass += 1) {
                const shortfall = await modal.webContents.executeJavaScript(`
                    (() => {
                        const m = document.getElementById('message');
                        return Math.max(0, m.scrollHeight - m.clientHeight);
                    })();
                `);

                if (shortfall <= 0) {
                    break;
                }

                const [, height] = modal.getContentSize();
                if (height >= MAX_HEIGHT) {
                    break; // Genuinely too long: let it scroll.
                }
                modal.setContentSize(width, Math.min(MAX_HEIGHT, height + shortfall));
            }

            modal.center();
        } catch (error) {
            console.error('Alert render failed:', error);
        }

        modal.show();
    });

    modal.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(PAGE)}`);
    return modal;
}

module.exports = { showAlert };
