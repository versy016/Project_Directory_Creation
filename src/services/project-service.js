'use strict';

const fs = require('fs');
const fr = require('fs-extra');
const path = require('path');

const { roots } = require('../config/roots');
const { forType, ffsConfigPath } = require('../core/paths');
const ffsConfig = require('../core/ffs-config');
const { copyDirectory, readExistingXmlConfig, writeXmlConfig } = require('./fs-repo');

/**
 * Creating a project or quote on disk.
 *
 * No DOM, no ipcRenderer, no electron. The caller passes a plain request object
 * and a `notify` callback for user-facing messages, which keeps the alerts firing
 * at the same points in the sequence as before while leaving this module testable.
 *
 * @typedef {object} CreateProjectRequest
 * @property {string}  clientName
 * @property {string}  projectName          already normalised and validated
 * @property {'clientProject'|'quoteDirectory'} creationType
 * @property {string}  selectedDrive        resolved shared root (G bucket or J)
 * @property {'Standard'|'DIT'|'RPAS'|null} projectType
 * @property {boolean} copyToShared
 * @property {{create: boolean, dateLabel: string}} transIn
 * @property {{create: boolean, dateLabel: string}} transOut
 * @property {{create: boolean, direction: string}} syncPair
 * @property {boolean} copyTransInFromQuote
 * @property {boolean} copyOhsFromQuote
 */

/**
 * Copy a folder across from the matching quote, preferring the local copy and
 * falling back to the shared one.
 *
 * BUG #3 (preserved): the OHS-to-local case tests one path and copies a different
 * one. Expressed through separate `accessPath` / `copyPath` arguments so the
 * mismatch stays visible instead of being quietly fixed while moving code.
 */
async function copyFromQuote({ label, accessPath, copyPath, fallbackPath, destination }) {
    try {
        await fs.promises.access(accessPath);
        await fr.copy(copyPath, destination);
        console.log(`${label} files copied from primary source.`);
    } catch (primaryError) {
        console.error('Primary source unavailable, trying secondary source:', primaryError);
        try {
            await fs.promises.access(fallbackPath);
            await fr.copy(fallbackPath, destination);
            console.log(`${label} files copied from secondary source.`);
        } catch (secondaryError) {
            console.error(`Error copying ${label} files from both sources:`, secondaryError);
        }
    }
}

/** Append this project's folder pair to the relevant .ffs_gui. */
async function writeSyncPair(request, notify) {
    const { clientName, projectName, creationType, selectedDrive, syncPair } = request;

    // Read and write resolve to the same file. They did not always: on the J drive
    // this used to read the G config and write the result to the J one, wiping
    // every pair it held (bug #25).
    const xmlConfigPath = ffsConfigPath(creationType, selectedDrive);
    const existingXmlConfig = await readExistingXmlConfig(xmlConfigPath);
    const existingPairsSet = ffsConfig.parseExistingPairsToSet(existingXmlConfig);

    const folderPairsXml = ffsConfig.generateFolderPairsXml({
        clientName,
        projects: [{ name: projectName, direction: syncPair.direction, syncEnabled: true }],
        existingPairsSet,
        creationType,
        selectedDrive,
    });

    const updatedXmlConfig = existingXmlConfig
        ? ffsConfig.appendFolderPairsToExistingXml(existingXmlConfig, folderPairsXml)
        : ffsConfig.createFullXmlConfig(folderPairsXml);

    try {
        await writeXmlConfig(xmlConfigPath, updatedXmlConfig);
        notify('Project created successfully.');
    } catch (error) {
        console.error('Failed to write XML configuration or execute sync:', error);
        notify('An error occurred while setting up the synchronization.');
    }
}

/**
 * Copy the newly created project up to the shared drive.
 *
 * BUG #27 FIXED: this used to re-derive the shared root from the client name via
 * getSharedDrivePath, which only ever returns a G path -- so with the J toggle on,
 * the existence check looked at J while the copy went to G and the project landed
 * on the wrong drive. It now receives the same resolved root the rest of the
 * sequence uses.
 */
async function copyToShared({ clientName, projectName, sharedRoot }, source, notify) {
    const clientPath = path.join(sharedRoot, clientName);
    await fs.promises.mkdir(clientPath, { recursive: true });

    const destination = path.join(clientPath, projectName);
    if (fs.existsSync(destination)) {
        notify('Project already exists in the shared drive.');
        return false;
    }

    await copyDirectory(source, destination);
    console.log('✅ Successfully copied to shared drive:', destination);
    return true;
}

/**
 * @param {CreateProjectRequest} request
 * @param {{notify?: (message: string) => void, resolveSharedRoot: (client: string) => string}} deps
 * @returns {Promise<{created: boolean}>}
 */
async function createProject(request, deps) {
    const { notify = () => {}, resolveSharedRoot } = deps;
    const {
        clientName,
        projectName,
        creationType,
        selectedDrive,
        projectType,
        transIn,
        transOut,
        syncPair,
    } = request;

    const modePaths = forType(creationType, { selectedDrive });
    const standardFolderPath = modePaths.templates.standard;

    // One resolved shared root, used for both the existence check and the copy.
    // Those disagreeing was bug #27.
    //
    // The fallback covers bug #12: `selectedDrive` is empty until the first Search,
    // so opening the form and submitting straight away would otherwise leave
    // sharedRoot as '' and path.join would produce a RELATIVE destination --
    // silently writing the project next to the executable.
    const sharedRoot = modePaths.sharedRoot || resolveSharedRoot(clientName);

    const newProjectPathLocal = path.join(modePaths.localRoot, clientName, projectName);
    const newProjectPathShared = path.join(sharedRoot, clientName, projectName);

    const existsLocally = fs.existsSync(newProjectPathLocal);
    const existsOnShared = fs.existsSync(newProjectPathShared);

    if (existsLocally) {
        notify(`Project "${projectName}" already exists in C Drive.`);
    }
    if (existsOnShared) {
        notify(`Project "${projectName}" already exists in G Drive.`);
    }
    if (existsLocally && existsOnShared) {
        return { created: false };
    }

    if (!existsLocally) {
        await fs.promises.mkdir(newProjectPathLocal, { recursive: true });
        await copyDirectory(standardFolderPath, newProjectPathLocal);

        if (projectType === 'DIT') {
            await copyDirectory(modePaths.templates.dit, newProjectPathLocal);
        }
        if (projectType === 'RPAS') {
            await copyDirectory(modePaths.templates.rpas, newProjectPathLocal);
        }

        // FIXED: the dated transfer folders are created in the new project itself.
        //
        // They used to be created inside the SHARED template so the copy above
        // would pick them up, then deleted from the template again afterwards.
        // That briefly mutated a network directory every other user reads from --
        // two people creating projects at the same moment could see each other's
        // dated folders, or delete one still in use. Creating them here is both
        // simpler and safe, and the observable result is identical: the folders
        // are in place before the copy to the shared drive below.
        if (transIn.create) {
            await fs.promises.mkdir(path.join(newProjectPathLocal, 'TransIn', transIn.dateLabel), {
                recursive: true,
            });
        }
        if (transOut.create) {
            await fs.promises.mkdir(
                path.join(newProjectPathLocal, 'TransOut', transOut.dateLabel),
                { recursive: true }
            );
        }
    }

    if (request.copyToShared && !existsOnShared) {
        notify(
            creationType === 'quoteDirectory'
                ? 'Quote successfully copied to Tender folder in G Drive.'
                : 'Project successfully copied to G Drive.'
        );
        await copyToShared({ clientName, projectName, sharedRoot }, newProjectPathLocal, notify);
    }

    if (syncPair.create) {
        await writeSyncPair(request, notify);
    }

    // No template cleanup needed any more -- nothing is written into the template.

    // Carry TransIn / OHS across from the matching quote folder, if asked.
    const quoteTransIn = path.join(roots.localAccounts, clientName, projectName, 'TransIn');
    const sharedTransIn = path.join(roots.sharedQuotes, clientName, projectName, 'TransIn');
    const quoteOHS = path.join(roots.localAccounts, clientName, projectName, 'OHS');
    const sharedOHS = path.join(roots.sharedQuotes, clientName, projectName, 'OHS');

    if (request.copyTransInFromQuote) {
        await copyFromQuote({
            label: 'TransIn',
            accessPath: quoteTransIn,
            copyPath: quoteTransIn,
            fallbackPath: sharedTransIn,
            destination: path.join(roots.localClients, clientName, projectName, 'TransIn'),
        });
    }
    if (request.copyToShared && request.copyTransInFromQuote) {
        await copyFromQuote({
            label: 'TransIn',
            accessPath: quoteTransIn,
            copyPath: quoteTransIn,
            fallbackPath: sharedTransIn,
            destination: path.join(sharedRoot, clientName, projectName, 'TransIn'),
        });
    }
    if (request.copyOhsFromQuote) {
        await copyFromQuote({
            label: 'OHS',
            // BUG #3 preserved: tests the SHARED path, then copies the LOCAL one.
            accessPath: sharedOHS,
            copyPath: quoteOHS,
            fallbackPath: sharedOHS,
            destination: path.join(roots.localClients, clientName, projectName, 'OHS'),
        });
    }
    if (request.copyToShared && request.copyOhsFromQuote) {
        await copyFromQuote({
            label: 'OHS',
            accessPath: quoteOHS,
            copyPath: quoteOHS,
            fallbackPath: sharedOHS,
            destination: path.join(sharedRoot, clientName, projectName, 'OHS'),
        });
    }

    return { created: true };
}

module.exports = { createProject };
