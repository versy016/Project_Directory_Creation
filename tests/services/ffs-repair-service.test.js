'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    repairSyncConfigs,
    describeRepairs,
    readMajorClients,
    projectLabel,
} = require('../../src/services/ffs-repair-service');
const ffs = require('../../src/core/ffs-config');
const { CLIENT_PROJECT } = require('../../src/core/paths');

/** The scan takes {name, mode, jDrive} entries -- the filename decides the roots. */
const CLIENTS_CONFIG = { name: 'SyncSettings.ffs_gui', mode: CLIENT_PROJECT, jDrive: false };

const BROKEN_PAIR = `        <Pair>
            <Left>C:\\_Clients\\Sarah Build\\E20210092_Sarah Build PAC</Left>
            <Right>G:/Shared drives/_S\\Sarah Build\\E20210092_Sarah Build PAC</Right>
            <Synchronize>
                <Changes>
                    <Left Create="right" Update="right" Delete="none"/>
                    <Right Create="none" Update="none" Delete="right"/>
                </Changes>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`;

const config = (pairs) =>
    ffs.createFullXmlConfig('').replace('    </FolderPairs>', `${pairs}\n    </FolderPairs>`);

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdc-ffs-'));
    return dir;
}

test('a broken config is repaired and backed up', () => {
    const dir = sandbox();
    const file = path.join(dir, 'SyncSettings.ffs_gui');
    const original = config(BROKEN_PAIR);
    fs.writeFileSync(file, original, 'utf-8');

    const report = repairSyncConfigs({ configDir: dir });

    assert.equal(report.repaired.length, 1);
    assert.equal(report.repaired[0].pairs.length, 1);

    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(after.includes(ffs.DIFFERENCES_ONE_WAY), 'the pair should be restored');

    // The backup must be the untouched original, so the user can revert.
    assert.equal(fs.readFileSync(`${file}.bak`, 'utf-8'), original);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('a healthy config is left completely alone -- no rewrite, no backup', () => {
    const dir = sandbox();
    const file = path.join(dir, 'SyncSettings.ffs_gui');
    const healthy = config(ffs.renderPair('C:\\a', 'G:\\b', ffs.DIFFERENCES_ONE_WAY));
    fs.writeFileSync(file, healthy, 'utf-8');

    const report = repairSyncConfigs({ configDir: dir });

    assert.deepEqual(report.repaired, []);
    assert.equal(fs.readFileSync(file, 'utf-8'), healthy);
    assert.ok(!fs.existsSync(`${file}.bak`), 'no backup for a file that was not changed');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('all three configs are scanned, and missing ones are skipped quietly', () => {
    const dir = sandbox();
    fs.writeFileSync(path.join(dir, 'SyncSettings.ffs_gui'), config(BROKEN_PAIR), 'utf-8');
    fs.writeFileSync(path.join(dir, 'SyncSettingsJdrive.ffs_gui'), config(BROKEN_PAIR), 'utf-8');
    // SyncSettings_Quotes.ffs_gui deliberately absent.

    const report = repairSyncConfigs({ configDir: dir });

    assert.deepEqual(report.scanned.sort(), [
        'SyncSettings.ffs_gui',
        'SyncSettingsJdrive.ffs_gui',
    ]);
    assert.equal(report.repaired.length, 2);
    assert.deepEqual(report.errors, []);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable config is reported, not thrown, and the original survives', () => {
    const original = config(BROKEN_PAIR);

    const io = {
        existsSync: () => true,
        readFileSync: () => original,
        writeFileSync: () => {
            throw new Error('EACCES: permission denied');
        },
    };

    const report = repairSyncConfigs({ configDir: 'X:\\nowhere', files: [CLIENTS_CONFIG], io });

    assert.deepEqual(report.repaired, []);
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0].message, /EACCES/);
});

test('the backup is written before the config, so a failure cannot lose data', () => {
    const writes = [];
    const io = {
        existsSync: () => true,
        readFileSync: () => config(BROKEN_PAIR),
        writeFileSync: (file) => writes.push(path.basename(file)),
    };

    repairSyncConfigs({ configDir: 'X:\\nowhere', files: [CLIENTS_CONFIG], io });

    assert.deepEqual(writes, ['SyncSettings.ffs_gui.bak', 'SyncSettings.ffs_gui']);
});

test('repeating the scan finds nothing the second time', () => {
    const dir = sandbox();
    const file = path.join(dir, 'SyncSettings.ffs_gui');
    fs.writeFileSync(file, config(BROKEN_PAIR), 'utf-8');

    assert.equal(repairSyncConfigs({ configDir: dir }).repaired.length, 1);
    assert.equal(repairSyncConfigs({ configDir: dir }).repaired.length, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('describeRepairs says nothing when there is nothing to say', () => {
    assert.equal(describeRepairs({ repaired: [], errors: [] }), null);
});

test('the message names each pair, its direction, and asks for review', () => {
    const message = describeRepairs({
        repaired: [
            {
                file: 'SyncSettings.ffs_gui',
                backup: 'C:\\Freefilesyncfiles\\SyncSettings.ffs_gui.bak',
                pairs: [
                    {
                        left: 'C:\\_Clients\\Sarah Build\\E20210092_Sarah Build PAC',
                        becomes: 'one-way',
                    },
                ],
            },
        ],
        errors: [],
    });

    assert.match(message, /1 FreeFileSync folder pair was repaired/);
    assert.match(message, /Sarah Build \\ E20210092_Sarah Build PAC/);
    assert.match(message, /restored to one-way/);
    assert.match(message, /SyncSettings\.ffs_gui\.bak/);
    assert.match(message, /Please review/);
});

test('the message pluralises and lists across files', () => {
    const message = describeRepairs({
        repaired: [
            { file: 'a.ffs_gui', backup: 'a.bak', pairs: [{ left: 'C:\\x\\P', becomes: 'one-way' }] },
            { file: 'b.ffs_gui', backup: 'b.bak', pairs: [{ left: 'C:\\y\\Q', becomes: 'two-way' }] },
        ],
        errors: [],
    });

    assert.match(message, /2 FreeFileSync folder pairs were repaired/);
    assert.match(message, /a\.ffs_gui/);
    assert.match(message, /b\.ffs_gui/);
});

test('failures are surfaced even when nothing could be repaired', () => {
    const message = describeRepairs({
        repaired: [],
        errors: [{ file: 'SyncSettings.ffs_gui', message: 'EACCES' }],
    });

    assert.match(message, /Could not be repaired/);
    assert.match(message, /EACCES/);
});

/**
 * Path repair, alongside the sync-mode repair. Both faults are fixed in one pass
 * so the user gets a single report rather than two alerts at launch.
 */
test('a pair pointing at the wrong shared folder is corrected', () => {
    const dir = sandbox();
    const file = path.join(dir, 'SyncSettings.ffs_gui');

    // Sarah Build is not a major client, so it belongs in the _S bucket.
    const wrong = config(`        <Pair>
            <Left>C:\\_Clients\\Sarah Build\\2023_X</Left>
            <Right>G:/Shared drives\\Sarah Build\\2023_X</Right>
            <Synchronize>
                <Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`);
    fs.writeFileSync(file, wrong, 'utf-8');

    const report = repairSyncConfigs({ configDir: dir, files: [CLIENTS_CONFIG] });

    assert.equal(report.repaired.length, 1);
    assert.equal(report.repaired[0].paths.length, 1);

    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(after.includes('G:/Shared drives/_S\\Sarah Build\\2023_X'), after);
    assert.equal(fs.readFileSync(`${file}.bak`, 'utf-8'), wrong, 'the original is backed up');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('a pair whose two sides disagree is reported, not rewritten', () => {
    const dir = sandbox();
    const file = path.join(dir, 'SyncSettings.ffs_gui');

    const mismatched = config(`        <Pair>
            <Left>C:\\_Clients\\ACME\\2024_Roadworks</Left>
            <Right>G:/Shared drives/_A\\ACME\\2024_Bridge</Right>
            <Synchronize>
                <Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`);
    fs.writeFileSync(file, mismatched, 'utf-8');

    const report = repairSyncConfigs({ configDir: dir, files: [CLIENTS_CONFIG] });

    assert.equal(report.repaired.length, 0, 'nothing should have been rewritten');
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0].reason, /different folders/);
    assert.equal(fs.readFileSync(file, 'utf-8'), mismatched, 'the file is untouched');
    assert.ok(!fs.existsSync(`${file}.bak`), 'and not backed up, since nothing changed');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('the report covers both kinds of repair and the unfixable ones', () => {
    const message = describeRepairs({
        repaired: [
            {
                file: 'SyncSettings.ffs_gui',
                backup: 'SyncSettings.ffs_gui.bak',
                pairs: [{ left: 'C:\\x\\ACME\\2024_A', becomes: 'one-way' }],
                paths: [{ client: 'Sarah Build', project: '2023_X', reason: 'wrong folder root' }],
            },
        ],
        errors: [],
        problems: [{ file: 'SyncSettings.ffs_gui', reason: 'the two sides name different folders' }],
    });

    assert.match(message, /2 FreeFileSync folder pairs were repaired/);
    assert.match(message, /use database file to detect changes/);
    assert.match(message, /pointed at the wrong folder/);
    assert.match(message, /Sarah Build \\ 2023_X {2}\(path fixed: wrong folder root\)/);
    assert.match(message, /need checking by hand/);
});

test('readMajorClients tolerates a UTF-8 BOM', () => {
    // The file is hand-edited on the share, where a Notepad save adds one and
    // JSON.parse then throws -- bug #26.
    const io = {
        existsSync: () => true,
        readFileSync: () => '\ufeff{ "majorClients": ["FULTON HOGAN"] }',
    };

    assert.deepEqual(readMajorClients(io), ['FULTON HOGAN']);
});

test('readMajorClients survives a missing or unparseable file', () => {
    assert.deepEqual(readMajorClients({ existsSync: () => false }), []);
    assert.deepEqual(
        readMajorClients({ existsSync: () => true, readFileSync: () => 'not json' }),
        []
    );
});

test('projectLabel shortens a full path to client and project', () => {
    assert.equal(
        projectLabel('C:\\_Clients\\Sarah Build\\2023_Mary_Mackillop'),
        'Sarah Build \\ 2023_Mary_Mackillop'
    );
    assert.equal(
        projectLabel('G:/Shared drives/_S\\Sarah Build\\2023_X'),
        'Sarah Build \\ 2023_X'
    );
    assert.equal(projectLabel(null), '(unknown)');
});
