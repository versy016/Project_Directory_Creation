'use strict';

const fs = require('fs');

const { state } = require('./state');
const { roots } = require('../config/roots');
const { getSharedDrivePath: resolveSharedDrivePath } = require('../core/paths');
const { readMajorClients } = require('../services/ffs-repair-service');

/**
 * The major-clients list and the shared-drive lookup that depends on it.
 *
 * Lives in its own module because two separate flows need it -- client-search
 * (resolving where to look) and new-project-form (resolving where to copy) -- and
 * neither should have to import the other.
 *
 * BUG #26 (open): JSON.parse throws on a UTF-8 BOM and the catch below quietly
 * falls back to an empty list. majorClients.json is hand-edited on the share, so
 * one save from Notepad as "UTF-8 with BOM" silently routes every major client
 * into the wrong _<Letter> bucket. The only symptom is the console line here.
 */
function loadMajorClients() {
    if (!fs.existsSync(roots.majorClientsFile)) {
        console.error('Error: majorClients.json file not found at', roots.majorClientsFile);
        state.majorClients = [];
        return;
    }

    // Shared with the launch-time config repair, which runs in the main process
    // and needs the same list. It also strips a UTF-8 BOM before parsing -- the
    // file is hand-edited on the share, and a Notepad save adds one that made
    // JSON.parse throw and silently emptied the list (bug #26).
    state.majorClients = readMajorClients();
    console.log('✅ Loaded major clients:', state.majorClients);
}

/**
 * Adapter over core/paths.getSharedDrivePath. The pure helper takes the list as an
 * argument; this supplies it from shared state and keeps the original operator
 * diagnostics, which are what catch typos in the hand-edited JSON.
 */
function getSharedDrivePath(clientNameRaw) {
    const clientName = (clientNameRaw || '').trim();
    if (!clientName) {
        console.error('Invalid client name:', clientNameRaw);
        return null;
    }

    const resolved = resolveSharedDrivePath(clientName, state.majorClients);

    if (resolved === roots.sharedBase) {
        console.log(`[getSharedDrivePath] Major client detected: ${clientName} → ${resolved}`);
    } else {
        const firstLetter = clientName[0].toUpperCase();
        if (firstLetter >= 'A' && firstLetter <= 'Z' && clientName.split(' ').length > 1) {
            console.warn(
                `[getSharedDrivePath] WARNING: '${clientName}' not found in majorClients, ` +
                    `falling back to _${firstLetter}. Check for typos or update ` +
                    `majorClients.json if needed.`
            );
        }
    }

    return resolved;
}

module.exports = { loadMajorClients, getSharedDrivePath };
