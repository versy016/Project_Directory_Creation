'use strict';

/**
 * Single source of truth for every drive root the application touches.
 *
 * PHASE 0 CONTRACT: the default values below are byte-for-byte identical to the
 * string literals currently hardcoded throughout script.js. Nothing here changes
 * behaviour. The point is that every root can now be redirected at runtime, which
 * is what makes the app testable without a network drive mounted.
 *
 *   set PDC_SHARED_ROOT=D:\sandbox\G
 *   set PDC_LOCAL_ROOT=D:\sandbox\C\_Clients
 *   npm start
 *
 * KNOWN INCONSISTENCY (deliberately preserved, do not "fix" here):
 * `sharedBase` uses FORWARD slashes because getSharedDrivePath() in script.js:64
 * builds it that way, while every other root uses backslashes. That difference is
 * observable -- it leaks into the FreeFileSync XML as mixed separators, and it is
 * why the `left.includes('G:\\')` checks in readAndProcessXmlConfig never match.
 * Changing it is a Phase 2 decision with its own test, not a Phase 0 cleanup.
 */

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

const roots = {
  // Local (workstation) roots
  localClients: env('PDC_LOCAL_ROOT', 'C:\\_Clients'),
  localAccounts: env('PDC_ACCTS_ROOT', 'C:\\__Accounts\\__Clients'),

  // Shared drive roots
  sharedBase: env('PDC_SHARED_ROOT', 'G:/Shared drives'),
  sharedQuotes: env(
    'PDC_SHARED_QUOTES_ROOT',
    'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients'
  ),
  jDriveClients: env('PDC_JDRIVE_ROOT', 'J:\\__Clients'),

  // Folder templates copied into every new project / quote
  projectTemplates: env(
    'PDC_PROJECT_TEMPLATES',
    'G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults'
  ),
  quoteTemplates: env(
    'PDC_QUOTE_TEMPLATES',
    'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults'
  ),

  // FreeFileSync .ffs_gui configuration directory
  ffsConfigDir: env('PDC_FFS_DIR', 'C:\\Freefilesyncfiles'),

  // Network-hosted list deciding which clients skip the _<Letter> bucketing
  majorClientsFile: env(
    'PDC_MAJOR_CLIENTS_FILE',
    'G:\\Shared drives\\ES Cloud\\_Admin\\IT_Utilities\\Development\\majorClients.json'
  ),

  // Referenced only by the dead skip-branch in generateFolderPairsXml (script.js:2033).
  // Kept so that branch can be tested and then deleted deliberately.
  legacySharedClients: env(
    'PDC_LEGACY_SHARED_CLIENTS',
    'G:\\Shared drives\\ES Cloud\\_Clients'
  ),
};

module.exports = { roots };
