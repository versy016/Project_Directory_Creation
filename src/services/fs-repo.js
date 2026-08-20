'use strict';

const fs = require('fs');
const path = require('path');

// The copy-progress window is a UI nicety, not part of the copy. Resolving
// ipcRenderer defensively lets this module -- and everything built on it, notably
// project-service -- run outside a renderer, which is what makes those services
// unit-testable without launching Electron.
const electron = require('electron');
const ipcRenderer = electron && electron.ipcRenderer;

async function withProgressWindow(work) {
    if (ipcRenderer) {
        await ipcRenderer.invoke('show-copying-in-progress');
    }
    try {
        return await work();
    } finally {
        if (ipcRenderer) {
            await ipcRenderer.invoke('close-copying-in-progress');
        }
    }
}

/**
 * Every filesystem read and write the renderer performs goes through here.
 *
 * This is the chokepoint that makes Phase 5 cheap: once `contextIsolation` is
 * turned on, only this file has to be re-pointed at the preload bridge instead of
 * at `fs` directly. Nothing above it imports `fs`.
 *
 * Ported from script.js. Behaviour is unchanged, including the error handling --
 * some of these swallow errors and some let them through, and callers depend on
 * the difference.
 */

/**
 * Directory names directly inside `directoryPath`. Rejects if it cannot be read.
 * Callers handle a missing client folder by catching and substituting [].
 */
function readProjectsFromDirectory(directoryPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(directoryPath, { withFileTypes: true }, (err, entries) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(entries.filter((entry) => entry.isDirectory()).map((folder) => folder.name));
        });
    });
}

/** Same as readProjectsFromDirectory. Both names existed in script.js. */
const readSubfolders = readProjectsFromDirectory;

/**
 * Does `projectName` exist directly inside `directory`?
 * Swallows errors and answers false, so an unmounted drive reads as "absent"
 * rather than breaking the table render.
 */
async function projectExists(directory, projectName) {
    try {
        const files = await fs.promises.readdir(directory);
        return files.includes(projectName);
    } catch (err) {
        console.error(`Error accessing directory '${directory}':`, err);
        return false;
    }
}

/**
 * Recursive total size in bytes.
 *
 * script.js defined this twice (bug #6); the second definition won at runtime and
 * is the one reproduced here. It deliberately does NOT catch -- an unreadable
 * subfolder rejects the whole call, which is what callers see today. The discarded
 * first definition swallowed errors and returned a partial total.
 */
async function getFolderSize(folderPath) {
    let totalSize = 0;
    const files = await fs.promises.readdir(folderPath, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(folderPath, file.name);
        if (file.isDirectory()) {
            totalSize += await getFolderSize(fullPath);
        } else {
            totalSize += (await fs.promises.stat(fullPath)).size;
        }
    }

    return totalSize;
}

/**
 * Recursive copy, with the main process showing a progress window either side.
 * Resolves true/false rather than throwing -- callers branch on the boolean.
 */
async function copyDirectory(source, destination) {
    return withProgressWindow(async () => {
        try {
            await fs.promises.cp(source, destination, { recursive: true });
            return true;
        } catch (err) {
            console.error('Copy failed:', err);
            return false;
        }
    });
}

/**
 * Read a .ffs_gui, or null when it is missing. The null is meaningful: it is what
 * makes the caller fall back to ffs-config.createFullXmlConfig instead of
 * appending to an existing document.
 */
async function readExistingXmlConfig(filePath) {
    try {
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
        console.error(err);
        return null;
    }
}

/**
 * Every {client, project} pair directly under a flat root.
 *
 * Clients whose name starts with `_` are skipped: those are the template and
 * admin folders (`_PDIR_Defaults`, `_ACCDIR_Defaults`), not real clients. A client
 * folder that cannot be read is skipped rather than failing the whole scan.
 */
async function listClientProjects(root) {
    let clients;
    try {
        clients = await readProjectsFromDirectory(root);
    } catch (err) {
        console.error(`Could not list clients under '${root}':`, err);
        return [];
    }

    const entries = [];

    for (const client of clients) {
        if (client.startsWith('_')) {
            continue;
        }
        try {
            for (const project of await readProjectsFromDirectory(path.join(root, client))) {
                entries.push({ client, project });
            }
        } catch (err) {
            console.error(`Skipping unreadable client folder '${client}':`, err);
        }
    }

    return entries;
}

/**
 * The same, for the bucketed shared drive.
 *
 * `G:\Shared drives` is the Google Drive shared-drives root, so it holds a lot
 * more than our clients -- alongside the `_A`.._Z` buckets there are other shared
 * drives entirely (ES Cloud, Accounts QT, Cadastral, DIT, Training) and the major
 * clients, which sit directly under the base rather than in a letter bucket.
 *
 * Only buckets and known major clients are descended into. Anything else at the
 * top level belongs to another shared drive and is left alone.
 */
async function listBucketedProjects(base, majorClients = []) {
    let top;
    try {
        top = await readProjectsFromDirectory(base);
    } catch (err) {
        console.error(`Could not list the shared root '${base}':`, err);
        return [];
    }

    const major = new Set(majorClients.map((name) => String(name).toUpperCase()));
    const entries = [];

    for (const name of top) {
        const isBucket = /^_[A-Z]$/i.test(name) || name === '_Misc';

        if (isBucket) {
            entries.push(...(await listClientProjects(path.join(base, name))));
            continue;
        }

        if (!major.has(name.toUpperCase())) {
            continue; // another shared drive, not one of our clients
        }

        try {
            for (const project of await readProjectsFromDirectory(path.join(base, name))) {
                entries.push({ client: name, project });
            }
        } catch (err) {
            console.error(`Skipping unreadable major client '${name}':`, err);
        }
    }

    return entries;
}

/**
 * Every project across both drives, tagged with where it lives.
 *
 * Measured against the real drives: the local walk is ~10ms and the whole shared
 * side ~0.9s, because Google Drive caches directory metadata locally. Fast enough
 * to build once and cache, not fast enough to redo on every keystroke.
 *
 * @returns {Promise<Array<{client: string, project: string, onLocal: boolean, onShared: boolean}>>}
 */
async function listProjectsAcrossDrives({
    localRoot,
    sharedRoot,
    bucketed = false,
    majorClients = [],
}) {
    const merged = new Map();

    const add = (entry, side) => {
        const key = `${entry.client}\u0000${entry.project}`;
        const existing = merged.get(key) || {
            client: entry.client,
            project: entry.project,
            onLocal: false,
            onShared: false,
        };
        existing[side] = true;
        merged.set(key, existing);
    };

    for (const entry of await listClientProjects(localRoot)) {
        add(entry, 'onLocal');
    }

    if (sharedRoot) {
        const shared = bucketed
            ? await listBucketedProjects(sharedRoot, majorClients)
            : await listClientProjects(sharedRoot);

        for (const entry of shared) {
            add(entry, 'onShared');
        }
    }

    return [...merged.values()];
}

/** Does this path exist? */
async function pathExists(target) {
    try {
        await fs.promises.access(target);
        return true;
    } catch (err) {
        return false;
    }
}

/** Write a .ffs_gui back out. Throws; callers report the failure to the user. */
async function writeXmlConfig(filePath, contents) {
    await fs.promises.writeFile(filePath, contents, 'utf-8');
}

module.exports = {
    readProjectsFromDirectory,
    readSubfolders,
    projectExists,
    pathExists,
    listClientProjects,
    listBucketedProjects,
    listProjectsAcrossDrives,
    getFolderSize,
    copyDirectory,
    readExistingXmlConfig,
    writeXmlConfig,
};
