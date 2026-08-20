'use strict';

const path = require('path');
const { roots } = require('../config/roots');

/**
 * Path derivation. Pure: no fs, no DOM, no electron.
 *
 * Every function here is a faithful port of logic currently inline in script.js.
 * Where the original has a quirk, the quirk is preserved and labelled -- Phase 1
 * freezes behaviour, it does not improve it.
 */

const CLIENT_PROJECT = 'clientProject';
const QUOTE_DIRECTORY = 'quoteDirectory';

/**
 * Port of script.js:56 getSharedDrivePath().
 *
 * Decides which G: bucket a client lives in. Major clients (listed in the
 * network-hosted majorClients.json) sit directly under the shared base; everyone
 * else is bucketed by first letter into _A .. _Z, with _Misc as the fallback.
 *
 * Differences from the original, both non-behavioural:
 *   - majorClients is a parameter instead of a module-level mutable global.
 *   - console.log / console.warn diagnostics are dropped.
 *
 * @param {string} clientNameRaw
 * @param {string[]} majorClients UPPERCASED client names
 * @returns {string|null} null when the name is blank
 */
function getSharedDrivePath(clientNameRaw, majorClients = []) {
  const clientName = (clientNameRaw || '').trim();

  // NOTE: the original also tests `typeof clientName !== 'string'`, which can
  // never be true after the `|| ''` coercion above. Kept as dead-but-harmless.
  if (!clientName) {
    return null;
  }

  const driveBasePath = roots.sharedBase;

  if (majorClients.includes(clientName.toUpperCase())) {
    return driveBasePath;
  }

  const firstLetter = clientName[0].toUpperCase();
  if (firstLetter >= 'A' && firstLetter <= 'Z') {
    return `${driveBasePath}/_${firstLetter}`;
  }

  return `${driveBasePath}/_Misc`;
}

/**
 * Which .ffs_gui file a given mode reads and writes.
 * Port of the identical three-way branch repeated at script.js:1426, 2307 and 2379.
 */
function ffsConfigPath(creationType, selectedDrive) {
  if (creationType === QUOTE_DIRECTORY) {
    return path.join(roots.ffsConfigDir, 'SyncSettings_Quotes.ffs_gui');
  }
  if (selectedDrive === roots.jDriveClients) {
    return path.join(roots.ffsConfigDir, 'SyncSettingsJdrive.ffs_gui');
  }
  return path.join(roots.ffsConfigDir, 'SyncSettings.ffs_gui');
}

/**
 * The full root set for a mode. This is the function that collapses the
 * `if (selectedCreationType === 'quoteDirectory')` branch currently repeated
 * about a dozen times across script.js.
 *
 * @param {'clientProject'|'quoteDirectory'} creationType
 * @param {{selectedDrive?: string}} opts selectedDrive is the resolved G:/J: root
 */
function forType(creationType, { selectedDrive = '' } = {}) {
  if (creationType === QUOTE_DIRECTORY) {
    return {
      creationType,
      localRoot: roots.localAccounts,
      sharedRoot: roots.sharedQuotes,
      templates: {
        // Quotes copy the _ACCDIR_Defaults folder itself -- there is no
        // _Standard subfolder and no DIT/RPAS overlay. (script.js:1303)
        standard: roots.quoteTemplates,
        dit: null,
        rpas: null,
      },
      ffsConfigPath: ffsConfigPath(creationType, selectedDrive),
    };
  }

  return {
    creationType: CLIENT_PROJECT,
    localRoot: roots.localClients,
    sharedRoot: selectedDrive,
    templates: {
      standard: path.join(roots.projectTemplates, '_Standard'),
      dit: path.join(roots.projectTemplates, 'DIT'),
      rpas: path.join(roots.projectTemplates, 'RPAS'),
    },
    ffsConfigPath: ffsConfigPath(CLIENT_PROJECT, selectedDrive),
  };
}

/** <root>\<client> */
function clientDir(root, clientName) {
  return path.join(root, clientName);
}

/** <root>\<client>\<project> */
function projectDir(root, clientName, projectName) {
  return path.join(root, clientName, projectName);
}

/**
 * Dated transfer folder inside the shared template directory.
 * Port of script.js:1333 / 1342. See project-service for why this exists --
 * the app creates the folder in the template, copies it, then deletes it again.
 */
function templateTransferDir(templateStandardRoot, direction, dateLabel) {
  return path.join(templateStandardRoot, direction, dateLabel);
}

module.exports = {
  CLIENT_PROJECT,
  QUOTE_DIRECTORY,
  getSharedDrivePath,
  ffsConfigPath,
  forType,
  clientDir,
  projectDir,
  templateTransferDir,
};
