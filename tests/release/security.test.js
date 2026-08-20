'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf-8');

/**
 * Guards on the renderer's security posture.
 *
 * These are source-level assertions, which is unusual -- but the settings they
 * cover are one-line changes that silently undo Phase 5, and nothing else would
 * notice. Flipping contextIsolation back off does not break a single test or
 * change any visible behaviour; it just quietly hands the page full filesystem
 * access again.
 */

test('the renderer runs isolated', async (t) => {
    await t.test('contextIsolation is on', () => {
        assert.match(mainJs, /contextIsolation:\s*true/);
        assert.doesNotMatch(mainJs, /contextIsolation:\s*false/);
    });

    await t.test('nodeIntegration is off', () => {
        assert.match(mainJs, /nodeIntegration:\s*false/);
        assert.doesNotMatch(mainJs, /nodeIntegration:\s*true/);
    });

    await t.test('a preload is configured', () => {
        assert.match(mainJs, /preload:\s*path\.join\(__dirname,\s*'preload\.js'\)/);
    });

    await t.test('webSecurity stays on', () => {
        assert.doesNotMatch(mainJs, /webSecurity:\s*false/);
    });
});

test('the page cannot load renderer code itself', () => {
    // With contextIsolation on, a page <script> has no `require`, so a script tag
    // pointing into src/ would fail silently. The renderer is loaded by preload.js.
    assert.doesNotMatch(
        indexHtml,
        /<script\s+src=["'](?!https:)[^"']*\.js["']/i,
        'index.html must not load local scripts directly -- they cannot require src/'
    );
});

test('the main-world surface is a named allow-list, not a passthrough', async (t) => {
    await t.test('nothing exposes a generic ipcRenderer or invoke bridge', () => {
        // A bridge like exposeInMainWorld('ipc', ipcRenderer) would hand the page
        // the ability to call any channel, which is barely better than nodeIntegration.
        assert.doesNotMatch(preloadJs, /exposeInMainWorld\(\s*['"][^'"]*['"]\s*,\s*ipcRenderer\s*\)/);
        assert.doesNotMatch(preloadJs, /exposeInMainWorld\([^)]*\binvoke\b\s*:/);
    });

    await t.test('every exposed name is one the page actually calls', () => {
        const exposed = [...preloadJs.matchAll(/exposeInMainWorld\(\s*name/g)];
        assert.ok(exposed.length > 0, 'expected a contextBridge exposure loop');

        // The allow-list object is the single source of truth; keep it small.
        const block = preloadJs.slice(
            preloadJs.indexOf('const MAIN_WORLD_API'),
            preloadJs.indexOf('};', preloadJs.indexOf('const MAIN_WORLD_API'))
        );
        const names = [...block.matchAll(/^\s{4}(\w+)[,:]/gm)].map((m) => m[1]);

        assert.deepEqual(
            names.sort(),
            [
                'copyFoldersOnly',
                'copyProject',
                'createProject',
                'fetchAndIndexClients',
                'fetchAndIndexContacts',
                'fetchAndIndexTenders',
                'refreshApp',
            ],
            'the main-world surface changed -- confirm each addition is genuinely ' +
                'needed by an inline onclick or by main.js, then update this list'
        );
    });
});

test('no renderer module reaches for fs directly', () => {
    // services/fs-repo is the single filesystem chokepoint. Anything above it
    // importing fs would undo that, and it is the seam the whole layering rests on.
    const rendererDir = path.join(ROOT, 'src', 'renderer');

    for (const file of fs.readdirSync(rendererDir).filter((f) => f.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(rendererDir, file), 'utf-8');
        const importsFs = /require\(['"](fs|fs-extra|node:fs)['"]\)/.test(source);

        // major-clients reads majorClients.json synchronously at startup; it is the
        // one documented exception and should move into fs-repo eventually.
        if (file === 'major-clients.js') {
            continue;
        }

        assert.equal(
            importsFs,
            false,
            `src/renderer/${file} requires fs directly -- go through services/fs-repo`
        );
    }
});
