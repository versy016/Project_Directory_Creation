'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Builds a throwaway drive tree that mirrors the real layout, and returns the
 * PDC_* environment that points the app at it.
 *
 * Shape (client "ACME"):
 *   C/_Clients/ACME/2024_Shared        <- on both drives  -> "common"
 *   C/_Clients/ACME/2023_LocalOnly     <- C only
 *   G/_A/ACME/2024_Shared              <- on both drives
 *   G/_A/ACME/2022_SharedOnly          <- G only
 *
 * ACME is not in majorClients, so it buckets to G/_A -- which is what makes the
 * bucketing logic part of the test rather than an assumption.
 */
function buildSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdc-e2e-'));

  const dirs = [
    'C/_Clients/ACME/2024_Shared',
    'C/_Clients/ACME/2023_LocalOnly',
    // A second local-only project, so the sort has something to reorder. With one
    // project per bucket no sort order is distinguishable from any other.
    'C/_Clients/ACME/2020_Zulu',
    // Quote folders, so the project search can be checked in Quote mode too.
    'C/__Accounts/__Clients/ACME/2024_QuoteOne',
    'C/__Accounts/__Clients/ACME/2022_QuoteTwo',

    // A template folder directly under the local root: the index must skip
    // leading-underscore directories rather than offer them as clients.
    'C/_Clients/_PDIR_Defaults/_Standard',

    'G/_A/ACME/2024_Shared',
    'G/_A/ACME/2022_SharedOnly',

    // A MAJOR client. Listed in majorClients.json, so it skips the _<Letter>
    // bucketing and sits directly under the shared base. This exists because a
    // regression in loadMajorClients is invisible against ACME alone -- an empty
    // major-clients list still routes ACME correctly.
    'C/_Clients/FULTON HOGAN/2024_MajorShared',
    'G/FULTON HOGAN/2024_MajorShared',
    'G/quotes/ACME',

    // The J: network drive, reachable via the toggle. Note J has no _<Letter>
    // bucketing -- clients sit directly under the root.
    'J/ACME/2021_JOnly',
    'J/ACME/2024_Shared',

    // United Precast, foldered by ES REFERENCE ("UPC") as in reality. Not a major
    // client, so it buckets by the reference's first letter: U.
    //
    // One project of each kind, so the drive badge has all three cases to report:
    //   2026_UPJob      on both drives  -> "Both"
    //   2026_LocalJob   local only      -> "C"
    //   2026_SharedJob  shared only     -> "G"
    'C/_Clients/UPC/2026_UPJob',
    'G/_U/UPC/2026_UPJob',
    'C/_Clients/UPC/2026_LocalJob',
    'G/_U/UPC/2026_SharedJob',

    'G/templates/_Standard/TransIn',
    'G/templates/_Standard/TransOut',
    'G/templates/_Standard/OHS',
    'G/templates/DIT',
    'G/templates/RPAS',
    'G/quote-templates',
    'ffs',
  ];

  // A client with more projects than one page, so paging has something to page.
  // Named so the sort order is unambiguous: 2024_P00 .. 2024_P24.
  for (let i = 0; i < 25; i += 1) {
    dirs.push(`C/_Clients/PAGED/2024_P${String(i).padStart(2, '0')}`);
  }

  for (const dir of dirs) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }

  // Marker files so a template copy is observable on disk.
  write(path.join(root, 'G/templates/_Standard/readme.txt'), 'standard template');
  write(path.join(root, 'G/templates/DIT/dit-marker.txt'), 'dit template');
  write(path.join(root, 'G/templates/RPAS/rpas-marker.txt'), 'rpas template');

  // No BOM -- see bug #26. loadMajorClients cannot parse one.
  write(path.join(root, 'majorClients.json'), '{ "majorClients": ["FULTON HOGAN"] }');

  /**
   * Offline stand-in for the Algolia Tenders index, consumed via PDC_FAKE_SEARCH.
   *
   * These are the real records the live index returns for "United Precast 2026",
   * plus decoys: an older job for the same client, and a 2026 job for a different
   * client. Between them they pin the exact scenario the feature was asked for --
   * Client "United Precast" + Project "2026" should show the three 2026 jobs and
   * neither the 2018 one nor the other client's.
   */
  write(
    path.join(root, 'search-fixture.json'),
    JSON.stringify({
      Tenders: [
        { reference: 'E20260192', name: 'UP1354_ServiceStationMillicent', client_name: 'United Precast' },
        { reference: 'E20260191', name: 'UP1337_NicholsonAveWhyallaNorrie', client_name: 'United Precast' },
        { reference: 'E20260254', name: 'Updated Survey Rates', client_name: 'United Precast' },
        { reference: 'E20180208', name: 'Old Depot Job', client_name: 'United Precast' },
        { reference: 'E20260093', name: '2026 Rates', client_name: 'Bottlebrush Pty Ltd' },
        { reference: 'E20240123', name: 'Roadworks Survey', client_name: 'ACME' },
      ],
      // The ES Reference deliberately differs from the name here, mirroring the
      // real index (276 of 1000 sampled clients are like this -- "McConnell
      // Dowell Diona JV" is "MDJV"). Folders on disk are named by the REFERENCE,
      // so selecting a project has to resolve name -> reference or the search
      // that follows looks in a folder that does not exist.
      clients: [
        { reference: 'UPC', title: 'United Precast' },
        { reference: 'ACME', title: 'ACME' },
      ],
      contacts: [],
    })
  );

  fs.copyFileSync(
    path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
    path.join(root, 'ffs', 'SyncSettings.ffs_gui')
  );
  fs.copyFileSync(
    path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
    path.join(root, 'ffs', 'SyncSettings_Quotes.ffs_gui')
  );
  fs.copyFileSync(
    path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
    path.join(root, 'ffs', 'SyncSettingsJdrive.ffs_gui')
  );

  return {
    root,
    env: {
      PDC_LOCAL_ROOT: path.join(root, 'C', '_Clients'),
      PDC_ACCTS_ROOT: path.join(root, 'C', '__Accounts', '__Clients'),
      PDC_SHARED_ROOT: path.join(root, 'G'),
      PDC_SHARED_QUOTES_ROOT: path.join(root, 'G', 'quotes'),
      PDC_JDRIVE_ROOT: path.join(root, 'J'),
      // NOTE: the sandbox roots contain no literal "G:" or "J:" drive letters, so
      // the cross-drive skip in generateFolderPairsXml (which substring-matches on
      // those) cannot be exercised here. That branch is covered by unit tests
      // instead -- see tests/core/ffs-config.test.js.

      PDC_PROJECT_TEMPLATES: path.join(root, 'G', 'templates'),
      PDC_QUOTE_TEMPLATES: path.join(root, 'G', 'quote-templates'),
      PDC_FFS_DIR: path.join(root, 'ffs'),
      PDC_MAJOR_CLIENTS_FILE: path.join(root, 'majorClients.json'),
      // Answers every Algolia search from the fixture above, so the project
      // search can be tested offline and deterministically.
      PDC_FAKE_SEARCH: path.join(root, 'search-fixture.json'),
    },
  };
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf-8');
}

module.exports = { buildSandbox };
