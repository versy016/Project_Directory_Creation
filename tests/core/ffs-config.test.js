'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const legacy = require('../legacy/legacy-implementations');
const ffs = require('../../src/core/ffs-config');

const CREATION_TYPES = ['clientProject', 'quoteDirectory'];
const DIRECTIONS = ['Update Both', 'Update Right', 'Update Left'];
const CLIENT_NAMES = ['ACME', 'Smith & Sons', 'Two Words'];
const PROJECT_NAMES = ['2024_Roadworks', '2024_R&D'];
const SELECTED_DRIVES = [
  'G:/Shared drives/_A', // what getSharedDrivePath actually returns today
  'J:\\__Clients',
  'G:\\Shared drives\\ES Cloud\\_Clients', // the value the dead skip-branch expects
];

function* matrix() {
  for (const creationType of CREATION_TYPES) {
    for (const direction of DIRECTIONS) {
      for (const clientName of CLIENT_NAMES) {
        for (const projectName of PROJECT_NAMES) {
          for (const selectedDrive of SELECTED_DRIVES) {
            yield { creationType, direction, clientName, projectName, selectedDrive };
          }
        }
      }
    }
  }
}

test('generateFolderPairsXml matches the legacy implementation across the full matrix', () => {
  let cases = 0;

  for (const c of matrix()) {
    // Fresh objects per call: the legacy version rewrites project.name in place.
    const mine = ffs.generateFolderPairsXml({
      clientName: c.clientName,
      projects: [{ name: c.projectName, direction: c.direction }],
      existingPairsSet: new Set(),
      creationType: c.creationType,
      selectedDrive: c.selectedDrive,
    });

    const theirs = legacy.generateFolderPairsXml(
      c.clientName,
      [{ name: c.projectName, direction: c.direction }],
      new Set(),
      c.creationType,
      c.selectedDrive
    );

    assert.equal(mine, theirs, `mismatch for ${JSON.stringify(c)}`);
    cases += 1;
  }

  assert.equal(cases, 108, 'matrix size changed -- update this assertion deliberately');
});

test('generateFolderPairsXml matches legacy for multi-project batches', () => {
  const projects = [
    { name: '2024_Alpha', direction: 'Update Right' },
    { name: '2023_Beta', direction: 'Update Both' },
    { name: '2022_Gamma', direction: 'Update Left' },
  ];

  for (const creationType of CREATION_TYPES) {
    const mine = ffs.generateFolderPairsXml({
      clientName: 'ACME',
      projects: projects.map((p) => ({ ...p })),
      existingPairsSet: new Set(),
      creationType,
      selectedDrive: 'G:/Shared drives/_A',
    });

    const theirs = legacy.generateFolderPairsXml(
      'ACME',
      projects.map((p) => ({ ...p })),
      new Set(),
      creationType,
      'G:/Shared drives/_A'
    );

    assert.equal(mine, theirs, `mismatch for ${creationType}`);
  }
});

test('generateFolderPairsXml skips pairs already present in the config', () => {
  const args = {
    clientName: 'ACME',
    projects: [{ name: '2024_Roadworks', direction: 'Update Right' }],
    existingPairsSet: new Set(),
    creationType: 'clientProject',
    selectedDrive: 'G:/Shared drives/_A',
  };

  const first = ffs.generateFolderPairsXml(args);
  assert.ok(first.includes('<Pair>'));

  // Feeding the generated XML back in must produce nothing the second time --
  // this is what stops the .ffs_gui growing a duplicate pair on every click.
  const second = ffs.generateFolderPairsXml({
    ...args,
    existingPairsSet: ffs.parseExistingPairsToSet(first),
  });
  assert.equal(second, '');
});

test('generateFolderPairsXml: cross-drive skip behaviour', async (t) => {
  await t.test('on J:, quote pairs are dropped because they point at G:', () => {
    const result = ffs.generateFolderPairsXml({
      clientName: 'ACME',
      projects: [{ name: '2024_Roadworks', direction: 'Update Right' }],
      existingPairsSet: new Set(),
      creationType: 'quoteDirectory',
      selectedDrive: 'J:\\__Clients',
    });
    assert.equal(result, '');
  });

  await t.test('DEAD BRANCH: J: pairs are never filtered out of the G: config', () => {
    // The guard compares selectedDrive against a backslash literal that
    // getSharedDrivePath cannot produce (it returns forward slashes), so this
    // branch is unreachable in the running app. Frozen here so that deleting or
    // fixing it later is a visible, deliberate change.
    const reachable = ffs.shouldSkipPair(
      'G:/Shared drives/_A',
      'J:\\__Clients\\ACME\\2024_X',
      'C:\\_Clients\\ACME\\2024_X'
    );
    assert.equal(reachable, false);

    const unreachable = ffs.shouldSkipPair(
      'G:\\Shared drives\\ES Cloud\\_Clients',
      'J:\\__Clients\\ACME\\2024_X',
      'C:\\_Clients\\ACME\\2024_X'
    );
    assert.equal(unreachable, true);
  });
});

/**
 * FIXED: an unrecognised sync direction no longer corrupts the config.
 *
 * index.html gave the new-project dropdown value="Update LEft" with a capital E,
 * while every branch here tests for "Update Left". Choosing "Sync G To C" matched
 * nothing, left the paths undefined, and on the ordinary G-drive path wrote a
 * <Pair> containing the literal text "undefined" for Left, Right and Differences
 * straight into the user's real SyncSettings.ffs_gui. On J: it threw instead.
 *
 * The markup typo is fixed, and so is the underlying hole -- whatever the source
 * of a bad direction, the pair is skipped rather than written. The legacy
 * behaviour is asserted alongside, to show what changed.
 */
test('an unrecognised sync direction is skipped, never written', async (t) => {
  const projects = () => [{ name: '2024_Roadworks', direction: 'Update LEft' }];

  const generate = (selectedDrive, creationType = 'clientProject') =>
    ffs.generateFolderPairsXml({
      clientName: 'ACME',
      projects: projects(),
      existingPairsSet: new Set(),
      creationType,
      selectedDrive,
    });

  await t.test('nothing is emitted for it', () => {
    assert.equal(generate('G:/Shared drives/_A'), '');
  });

  await t.test('and nothing containing "undefined" can reach the config', () => {
    for (const drive of ['G:/Shared drives/_A', 'J:\\__Clients']) {
      for (const creationType of CREATION_TYPES) {
        assert.ok(!generate(drive, creationType).includes('undefined'));
      }
    }
  });

  await t.test('a valid direction alongside it is still written', () => {
    const xml = ffs.generateFolderPairsXml({
      clientName: 'ACME',
      projects: [
        { name: '2024_Bad', direction: 'Update LEft' },
        { name: '2024_Good', direction: 'Update Right' },
      ],
      existingPairsSet: new Set(),
      creationType: 'clientProject',
      selectedDrive: 'G:/Shared drives/_A',
    });

    assert.ok(xml.includes('2024_Good'), 'the healthy pair should survive');
    assert.ok(!xml.includes('2024_Bad'));
    assert.ok(!xml.includes('undefined'));
  });

  await t.test('the old behaviour, for contrast: a pair full of "undefined"', () => {
    const before = legacy.generateFolderPairsXml(
      'ACME',
      projects(),
      new Set(),
      'clientProject',
      'G:/Shared drives/_A'
    );

    assert.ok(before.includes('<Left>undefined</Left>'), 'this is what used to be written');
  });
});

test('DEVIATION: generateFolderPairsXml does not mutate its input', () => {
  const projects = [{ name: '2024_R&D', direction: 'Update Right' }];

  ffs.generateFolderPairsXml({
    clientName: 'Smith & Sons',
    projects,
    existingPairsSet: new Set(),
    creationType: 'clientProject',
    selectedDrive: 'G:/Shared drives/_A',
  });
  assert.equal(projects[0].name, '2024_R&D');

  // The legacy version rewrites the caller's object mid-loop.
  const legacyProjects = [{ name: '2024_R&D', direction: 'Update Right' }];
  legacy.generateFolderPairsXml(
    'Smith & Sons',
    legacyProjects,
    new Set(),
    'clientProject',
    'G:/Shared drives/_A'
  );
  assert.equal(legacyProjects[0].name, '2024_R&amp;D');
});

test('ampersands are escaped in both the client and project name', () => {
  const result = ffs.generateFolderPairsXml({
    clientName: 'Smith & Sons',
    projects: [{ name: '2024_R&D', direction: 'Update Right' }],
    existingPairsSet: new Set(),
    creationType: 'clientProject',
    selectedDrive: 'G:/Shared drives/_A',
  });

  assert.ok(result.includes('Smith &amp; Sons'));
  assert.ok(result.includes('2024_R&amp;D'));
  assert.ok(!/&(?!amp;)/.test(result), 'found a bare ampersand in the generated XML');
});

test('renderPair emits exactly the historical whitespace', () => {
  const expected =
    '\n' +
    '            <Pair>\n' +
    '                <Left>L</Left>\n' +
    '                <Right>R</Right>\n' +
    '                <Synchronize>\n' +
    '                    <D/>\n' +
    '                    <DeletionPolicy>RecycleBin</DeletionPolicy>\n' +
    '                    <VersioningFolder Style="Replace"/>\n' +
    '                </Synchronize>\n' +
    '            </Pair>\n';

  assert.equal(ffs.renderPair('L', 'R', '<D/>'), expected);
});

test('parseExistingPairsToSet matches the legacy implementation', () => {
  const samples = [
    '',
    '<FolderPairs></FolderPairs>',
    ffs.renderPair('C:\\a', 'G:\\b', '<D/>'),
    ffs.renderPair('C:\\a', 'G:\\b', '<D/>') + ffs.renderPair('C:\\c', 'G:\\d', '<D/>'),
    '<Left>x</Left><Right>y</Right>',
    '<Left>dup</Left>\n<Right>dup2</Right>\n<Left>dup</Left>\n<Right>dup2</Right>',
  ];

  for (const sample of samples) {
    assert.deepEqual(
      [...ffs.parseExistingPairsToSet(sample)].sort(),
      [...legacy.parseExistingPairsToSet(sample)].sort(),
      `mismatch for ${JSON.stringify(sample.slice(0, 40))}`
    );
  }
});

test('parseExistingPairsToSet tolerates a null config', () => {
  // readExistingXmlConfig returns null when the file is missing; the caller
  // passes `existingXmlConfig || ''`, but guarding here removes the dependency.
  assert.deepEqual([...ffs.parseExistingPairsToSet(null)], []);
  assert.deepEqual([...ffs.parseExistingPairsToSet(undefined)], []);
});

test('appendFolderPairsToExistingXml matches legacy on the real shipped template', () => {
  const template = fs.readFileSync(
    path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
    'utf-8'
  );
  const pairs = ffs.renderPair('C:\\a', 'G:\\b', '<D/>');

  assert.equal(
    ffs.appendFolderPairsToExistingXml(template, pairs),
    legacy.appendFolderPairsToExistingXml(template, pairs)
  );
});

test('appendFolderPairsToExistingXml: documented behaviour', async (t) => {
  const template = fs.readFileSync(
    path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
    'utf-8'
  );

  await t.test('inserts before the closing tag and preserves the rest verbatim', () => {
    const pairs = ffs.renderPair('C:\\a', 'G:\\b', '<D/>');
    const result = ffs.appendFolderPairsToExistingXml(template, pairs);

    assert.ok(result.indexOf('<Left>C:\\a</Left>') < result.indexOf('</FolderPairs>'));
    assert.ok(result.includes('<Variant>TimeAndSize</Variant>'));
    assert.ok(result.includes('<Item>*\\thumbs.db</Item>'));
    assert.ok(result.includes('<GridViewType>Action</GridViewType>'));
  });

  await t.test('returns the input untouched when there is no <FolderPairs> block', () => {
    assert.equal(ffs.appendFolderPairsToExistingXml('<nope/>', '<Pair/>'), '<nope/>');
  });
});

/**
 * createFullXmlConfig did not exist before this refactor -- script.js called it
 * as the "config file is missing" fallback and threw ReferenceError instead.
 * There is no oracle to compare against, so these tests pin the new behaviour.
 */
test('createFullXmlConfig: the previously-missing fallback', async (t) => {
  await t.test('produces a config whose skeleton matches the shipped template', () => {
    const shipped = fs.readFileSync(
      path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
      'utf-8'
    );
    const generated = ffs.createFullXmlConfig('');

    const strip = (xml) =>
      xml.replace(/<FolderPairs>[\s\S]*?<\/FolderPairs>/, '<FolderPairs/>').replace(/\r\n/g, '\n');

    assert.equal(strip(generated).trim(), strip(shipped).trim());
  });

  await t.test('round-trips: generated pairs parse back out identically', async () => {
    const pairsXml = ffs.generateFolderPairsXml({
      clientName: 'ACME',
      projects: [
        { name: '2024_Alpha', direction: 'Update Right' },
        { name: '2023_Beta', direction: 'Update Both' },
      ],
      existingPairsSet: new Set(),
      creationType: 'clientProject',
      selectedDrive: 'G:/Shared drives/_A',
    });

    const parsed = await ffs.parseFolderPairs(ffs.createFullXmlConfig(pairsXml));

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].cDriveProject, 'C:\\_Clients\\ACME\\2024_Alpha');
    assert.equal(parsed[0].variantSymbol, '>');
    assert.equal(parsed[1].variantSymbol, '<>');
  });

  await t.test('a generated config accepts appends like a hand-made one', () => {
    const base = ffs.createFullXmlConfig('');
    const appended = ffs.appendFolderPairsToExistingXml(
      base,
      ffs.renderPair('C:\\a', 'G:\\b', '<D/>')
    );

    assert.ok(appended.includes('<Left>C:\\a</Left>'));
    assert.deepEqual([...ffs.parseExistingPairsToSet(appended)], ['C:\\a|G:\\b']);
  });
});

test('parseFolderPairs: reading an existing config', async (t) => {
  await t.test('returns [] for empty input', async () => {
    assert.deepEqual(await ffs.parseFolderPairs(''), []);
    assert.deepEqual(await ffs.parseFolderPairs(null), []);
  });

  await t.test('returns [] for the shipped template, which has no pairs', async () => {
    const shipped = fs.readFileSync(
      path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
      'utf-8'
    );
    assert.deepEqual(await ffs.parseFolderPairs(shipped), []);
  });

  await t.test('returns [] rather than throwing on malformed XML', async () => {
    assert.deepEqual(await ffs.parseFolderPairs('<not-xml'), []);
  });

  await t.test('one unreadable pair does not hide the readable ones', async () => {
    // A pair in FreeFileSync's <Changes> form has no <Differences> element. It
    // used to throw and take every other pair with it, so the app reported no
    // synced projects at all -- see src/core/ffs-repair.
    const brokenPair =
      '\n            <Pair>\n' +
      '                <Left>C:\\_Clients\\A\\Broken</Left>\n' +
      '                <Right>G:\\x</Right>\n' +
      '                <Synchronize>\n' +
      '                    <Changes>\n' +
      '                        <Left Create="right" Update="right" Delete="none"/>\n' +
      '                        <Right Create="none" Update="none" Delete="right"/>\n' +
      '                    </Changes>\n' +
      '                </Synchronize>\n' +
      '            </Pair>\n';

    const xml = ffs.createFullXmlConfig(
      ffs.renderPair('C:\\_Clients\\A\\P', 'G:\\y', ffs.DIFFERENCES_ONE_WAY) +
        brokenPair +
        ffs.renderPair('C:\\_Clients\\A\\Q', 'G:\\z', ffs.DIFFERENCES_TWO_WAY)
    );

    const parsed = await ffs.parseFolderPairs(xml);

    assert.equal(parsed.length, 2, 'both healthy pairs should survive');
    assert.deepEqual(
      parsed.map((p) => p.cDriveProject),
      ['C:\\_Clients\\A\\P', 'C:\\_Clients\\A\\Q']
    );
  });

  await t.test('maps two-way pairs to <> and one-way pairs to a direction', async () => {
    const xml = ffs.createFullXmlConfig(
      ffs.renderPair('C:\\_Clients\\A\\P', 'G:\\x', ffs.DIFFERENCES_TWO_WAY) +
        ffs.renderPair('C:\\_Clients\\A\\Q', 'G:\\y', ffs.DIFFERENCES_ONE_WAY)
    );

    const parsed = await ffs.parseFolderPairs(xml);
    assert.equal(parsed[0].variantSymbol, '<>');
    assert.equal(parsed[1].variantSymbol, '>');
  });

  await t.test('QUIRK: gDriveProject mislabels forward-slash and J: paths', async () => {
    // The check is left.includes('G:\\'), which never matches what this app
    // writes. The UI only substring-tests the result against a project name, so
    // the mislabelling is currently invisible -- but it is a trap for Phase 2.
    const xml = ffs.createFullXmlConfig(
      ffs.renderPair('J:\\__Clients\\A\\P', 'C:\\_Clients\\A\\P', ffs.DIFFERENCES_ONE_WAY)
    );

    const parsed = await ffs.parseFolderPairs(xml);
    assert.equal(parsed[0].cDriveProject, 'C:\\_Clients\\A\\P');
    assert.equal(parsed[0].gDriveProject, 'C:\\_Clients\\A\\P'); // not the J: path
  });
});
