'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const legacy = require('../legacy/legacy-implementations');
const { roots } = require('../../src/config/roots');
const paths = require('../../src/core/paths');

/**
 * Client names chosen to cover every branch and boundary in getSharedDrivePath:
 * major-client hit, ordinary letters, case handling, padding, empty input, and
 * three first-characters that sit just outside A-Z in code-point order.
 */
const CLIENT_NAMES = [
  'FULTON HOGAN',
  'WSP Australia',
  'Acme',
  'acme',
  'zebra',
  '  padded  ',
  '',
  '   ',
  '123 Numeric',
  '_Underscore',
  'Abc',
  null,
  undefined,
];

const MAJOR_CLIENT_SETS = [[], ['FULTON HOGAN'], ['ACME', 'WSP AUSTRALIA']];

test('roots defaults are byte-identical to the literals hardcoded in script.js', () => {
  // If this fails, the sandbox indirection has silently changed a real path and
  // every other test in the suite is validating the wrong thing.
  assert.equal(roots.localClients, 'C:\\_Clients');
  assert.equal(roots.localAccounts, 'C:\\__Accounts\\__Clients');
  assert.equal(roots.sharedBase, 'G:/Shared drives');
  assert.equal(roots.sharedQuotes, 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients');
  assert.equal(roots.jDriveClients, 'J:\\__Clients');
  assert.equal(roots.projectTemplates, 'G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults');
  assert.equal(
    roots.quoteTemplates,
    'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults'
  );
  assert.equal(roots.ffsConfigDir, 'C:\\Freefilesyncfiles');
  assert.equal(roots.legacySharedClients, 'G:\\Shared drives\\ES Cloud\\_Clients');
});

test('getSharedDrivePath matches the legacy implementation for every input', () => {
  for (const majorClients of MAJOR_CLIENT_SETS) {
    for (const name of CLIENT_NAMES) {
      assert.equal(
        paths.getSharedDrivePath(name, majorClients),
        legacy.getSharedDrivePath(name, majorClients),
        `mismatch for name=${JSON.stringify(name)} major=${JSON.stringify(majorClients)}`
      );
    }
  }
});

test('getSharedDrivePath: documented behaviour', async (t) => {
  await t.test('major clients sit directly under the shared base', () => {
    assert.equal(paths.getSharedDrivePath('Fulton Hogan', ['FULTON HOGAN']), 'G:/Shared drives');
  });

  await t.test('matching is case-insensitive', () => {
    assert.equal(paths.getSharedDrivePath('fulton hogan', ['FULTON HOGAN']), 'G:/Shared drives');
  });

  await t.test('everyone else is bucketed by first letter, uppercased', () => {
    assert.equal(paths.getSharedDrivePath('acme', []), 'G:/Shared drives/_A');
    assert.equal(paths.getSharedDrivePath('Zebra', []), 'G:/Shared drives/_Z');
  });

  await t.test('non A-Z first characters fall back to _Misc', () => {
    assert.equal(paths.getSharedDrivePath('123 Numeric', []), 'G:/Shared drives/_Misc');
    assert.equal(paths.getSharedDrivePath('_Underscore', []), 'G:/Shared drives/_Misc');
  });

  await t.test('blank input yields null rather than a bare drive root', () => {
    assert.equal(paths.getSharedDrivePath('', []), null);
    assert.equal(paths.getSharedDrivePath('   ', []), null);
    assert.equal(paths.getSharedDrivePath(null, []), null);
    assert.equal(paths.getSharedDrivePath(undefined, []), null);
  });

  await t.test('QUIRK: returns forward slashes, unlike every other root', () => {
    // Load-bearing. This is why the XML gets mixed separators and why the
    // includes('G:\\') checks elsewhere in the app never fire.
    assert.ok(paths.getSharedDrivePath('Acme', []).includes('/'));
    assert.ok(!paths.getSharedDrivePath('Acme', []).includes('\\'));
  });
});

test('ffsConfigPath selects the same file as the three branches in script.js', () => {
  assert.equal(
    paths.ffsConfigPath(paths.CLIENT_PROJECT, 'G:/Shared drives/_A'),
    path.join('C:\\Freefilesyncfiles', 'SyncSettings.ffs_gui')
  );
  assert.equal(
    paths.ffsConfigPath(paths.CLIENT_PROJECT, 'J:\\__Clients'),
    path.join('C:\\Freefilesyncfiles', 'SyncSettingsJdrive.ffs_gui')
  );
  assert.equal(
    paths.ffsConfigPath(paths.QUOTE_DIRECTORY, 'J:\\__Clients'),
    path.join('C:\\Freefilesyncfiles', 'SyncSettings_Quotes.ffs_gui')
  );
  assert.equal(
    paths.ffsConfigPath(paths.QUOTE_DIRECTORY, 'G:/Shared drives/_A'),
    path.join('C:\\Freefilesyncfiles', 'SyncSettings_Quotes.ffs_gui')
  );
});

test('forType(clientProject) reproduces the client-project roots', () => {
  const selectedDrive = 'G:/Shared drives/_A';
  const config = paths.forType(paths.CLIENT_PROJECT, { selectedDrive });

  assert.equal(config.localRoot, 'C:\\_Clients');
  assert.equal(config.sharedRoot, selectedDrive);
  assert.equal(
    config.templates.standard,
    path.join('G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults', '_Standard')
  );
  assert.equal(
    config.templates.dit,
    path.join('G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults', 'DIT')
  );
  assert.equal(
    config.templates.rpas,
    path.join('G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults', 'RPAS')
  );
});

test('forType(quoteDirectory) reproduces the quote roots', () => {
  const config = paths.forType(paths.QUOTE_DIRECTORY, { selectedDrive: 'J:\\__Clients' });

  assert.equal(config.localRoot, 'C:\\__Accounts\\__Clients');
  assert.equal(config.sharedRoot, 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients');

  // Quotes copy _ACCDIR_Defaults itself -- there is no _Standard subfolder and
  // no DIT/RPAS overlay. This asymmetry is real, see script.js:1303.
  assert.equal(
    config.templates.standard,
    'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults'
  );
  assert.equal(config.templates.dit, null);
  assert.equal(config.templates.rpas, null);
});

test('forType treats an unknown creationType as a client project', () => {
  // Matches the original's `if (quoteDirectory) ... else ...` shape.
  const config = paths.forType('somethingElse', { selectedDrive: 'G:/Shared drives/_A' });
  assert.equal(config.creationType, paths.CLIENT_PROJECT);
  assert.equal(config.localRoot, 'C:\\_Clients');
});

test('clientDir and projectDir compose roots in the documented order', () => {
  assert.equal(paths.clientDir('C:\\_Clients', 'ACME'), path.join('C:\\_Clients', 'ACME'));
  assert.equal(
    paths.projectDir('C:\\_Clients', 'ACME', '2024_Roadworks'),
    path.join('C:\\_Clients', 'ACME', '2024_Roadworks')
  );
});

test('templateTransferDir builds the dated folder created inside the template', () => {
  assert.equal(
    paths.templateTransferDir(
      'G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard',
      'TransIn',
      '2026_08_18'
    ),
    path.join(
      'G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard',
      'TransIn',
      '2026_08_18'
    )
  );
});
