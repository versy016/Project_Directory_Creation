'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    ensureGoogleDrive,
    watchForDrive,
    findDriveExecutable,
    compareVersionsDescending,
    notConnectedHeadline,
    isDriveConnected,
    DRIVE_FS_DIR,
} = require('../../src/main/google-drive');

const DRIVE_ROOT = 'G:/Shared drives';

/** Injected doubles: no filesystem, no timers, no Google Drive installed. */
function harness({ existsSequence, executable = 'GoogleDriveFS.exe' } = {}) {
    const calls = { launched: [], waits: 0, statuses: [] };
    let step = 0;

    return {
        calls,
        deps: {
            driveRoot: DRIVE_ROOT,
            timeoutMs: 5000,
            pollMs: 1000,
            exists: () => {
                const value = existsSequence[Math.min(step, existsSequence.length - 1)];
                step += 1;
                return value;
            },
            findExecutable: () => executable,
            launch: (exe) => calls.launched.push(exe),
            wait: async () => {
                calls.waits += 1;
            },
            onStatus: (status) => calls.statuses.push(status.state),
        },
    };
}

test('an already-connected drive is left alone', async () => {
    const { calls, deps } = harness({ existsSequence: [true] });
    const result = await ensureGoogleDrive(deps);

    assert.equal(result.connected, true);
    assert.equal(result.outcome, 'already-connected');
    assert.equal(result.message, null);
    assert.deepEqual(calls.launched, [], 'must not start Drive when it is already up');
    assert.deepEqual(calls.statuses, [], 'no spinner for a drive that is already there');
});

test('a disconnected drive starts Google Drive and succeeds once it mounts', async () => {
    // Absent on the first check, then appears after a couple of polls.
    const { calls, deps } = harness({ existsSequence: [false, false, true] });
    const result = await ensureGoogleDrive(deps);

    assert.equal(result.connected, true);
    assert.equal(result.outcome, 'launched');
    assert.deepEqual(calls.launched, ['GoogleDriveFS.exe']);
    assert.ok(calls.waits > 0, 'should have waited for the mount');
});

test('progress is reported so the window can show a spinner, not a frozen dialog', async () => {
    const { calls, deps } = harness({ existsSequence: [false, true] });
    await ensureGoogleDrive(deps);

    assert.deepEqual(calls.statuses, ['launching', 'waiting']);
});

test('the headline names the drive and is available before any launch attempt', () => {
    // This is what the window shows instantly, so it must not depend on the
    // outcome of the launch -- which is what took thirty seconds to arrive.
    assert.equal(
        notConnectedHeadline(DRIVE_ROOT),
        'Your Google Drive (G:/Shared drives) is not connected'
    );
});

test('isDriveConnected is a plain synchronous check', () => {
    assert.equal(isDriveConnected(DRIVE_ROOT, () => true), true);
    assert.equal(isDriveConnected(DRIVE_ROOT, () => false), false);
});

test('Drive not installed is reported without pretending to launch', async () => {
    const { calls, deps } = harness({ existsSequence: [false], executable: null });
    const result = await ensureGoogleDrive(deps);

    assert.equal(result.connected, false);
    assert.equal(result.outcome, 'not-installed');
    assert.match(result.message, /does not appear to be installed/);
    assert.deepEqual(calls.launched, []);
});

test('a launch that throws is reported, not swallowed', async () => {
    const { deps } = harness({ existsSequence: [false] });
    deps.launch = () => {
        throw new Error('EACCES');
    };

    const result = await ensureGoogleDrive(deps);

    assert.equal(result.connected, false);
    assert.equal(result.outcome, 'launch-failed');
    assert.match(result.message, /could not be started automatically/);
    assert.match(result.message, /EACCES/, 'the underlying reason should reach the user');
});

test('a drive that never appears times out rather than hanging', async () => {
    const { calls, deps } = harness({ existsSequence: [false] });
    const result = await ensureGoogleDrive(deps);

    assert.equal(result.connected, false);
    assert.equal(result.outcome, 'timeout');
    assert.match(result.message, /sign in using your browser/);
    assert.match(result.message, /Creating or copying projects will fail/);
    // timeoutMs / pollMs = 5 polls, so it must not spin forever.
    assert.ok(calls.waits <= 6, `polled ${calls.waits} times`);
});

test('the version is discovered and the path built from it', () => {
    // The binary lives in a versioned folder that changes with every update, so
    // the path must never be hardcoded. Several versions coexist; newest wins.
    const versions = ['126.0.5.0', '129.0.1.0', '128.0.0.0', '127.0.1.0', 'Drivers'];
    const newest = path.join(DRIVE_FS_DIR, '129.0.1.0', 'GoogleDriveFS.exe');

    const found = findDriveExecutable({
        exists: (p) =>
            p === DRIVE_FS_DIR ||
            p === newest ||
            p === path.join(DRIVE_FS_DIR, '128.0.0.0', 'GoogleDriveFS.exe'),
        readdir: () => versions,
    });

    assert.equal(found, newest);
});

test('the versioned binary is preferred over launch.bat', () => {
    // Both exist on a typical install. The exe is the documented way in.
    const exe = path.join(DRIVE_FS_DIR, '129.0.1.0', 'GoogleDriveFS.exe');

    const found = findDriveExecutable({
        exists: (p) => p === DRIVE_FS_DIR || p === exe || p === path.join(DRIVE_FS_DIR, 'launch.bat'),
        readdir: () => ['129.0.1.0'],
    });

    assert.equal(found, exe);
});

test('launch.bat is used when no versioned binary is present', () => {
    const found = findDriveExecutable({
        exists: (p) => p === path.join(DRIVE_FS_DIR, 'launch.bat'),
        readdir: () => [],
    });

    assert.equal(found, path.join(DRIVE_FS_DIR, 'launch.bat'));
});

test('a version folder with no binary in it is skipped', () => {
    // A part-removed update can leave the folder behind without the exe.
    const good = path.join(DRIVE_FS_DIR, '128.0.0.0', 'GoogleDriveFS.exe');

    const found = findDriveExecutable({
        exists: (p) => p === DRIVE_FS_DIR || p === good,
        readdir: () => ['129.0.1.0', '128.0.0.0'],
    });

    assert.equal(found, good, 'should fall through to the newest version that has a binary');
});

/**
 * After the initial attempt gives up, the notice must not close on a timer --
 * signing in through a browser takes as long as it takes. It keeps watching until
 * the drive appears or the user dismisses the notice.
 */
test('watchForDrive keeps polling until the drive appears', async () => {
    let checks = 0;
    const connected = await watchForDrive({
        driveRoot: DRIVE_ROOT,
        exists: () => ++checks >= 5,
        wait: async () => {},
    });

    assert.equal(connected, true);
    assert.equal(checks, 5, 'should have kept looking rather than giving up');
});

test('watchForDrive stops when the notice is dismissed', async () => {
    let ticks = 0;
    const connected = await watchForDrive({
        driveRoot: DRIVE_ROOT,
        exists: () => false,
        wait: async () => {
            ticks += 1;
        },
        shouldStop: () => ticks >= 3,
    });

    assert.equal(connected, false, 'a dismissed notice must not keep the watcher alive');
    assert.equal(ticks, 3);
});

test('watchForDrive returns immediately if the drive is already there', async () => {
    let waits = 0;
    const connected = await watchForDrive({
        driveRoot: DRIVE_ROOT,
        exists: () => true,
        wait: async () => {
            waits += 1;
        },
    });

    assert.equal(connected, true);
    assert.equal(waits, 0);
});

test('findDriveExecutable returns null when nothing is installed', () => {
    assert.equal(findDriveExecutable({ exists: () => false, readdir: () => [] }), null);
});

test('findDriveExecutable survives an unreadable install directory', () => {
    const found = findDriveExecutable({
        exists: (p) => p === DRIVE_FS_DIR,
        readdir: () => {
            throw new Error('EPERM');
        },
    });
    assert.equal(found, null);
});

test('version ordering is numeric, not lexicographic', () => {
    const sorted = ['9.0.0', '129.0.1.0', '99.1.0'].sort(compareVersionsDescending);
    assert.deepEqual(sorted, ['129.0.1.0', '99.1.0', '9.0.0']);
});
