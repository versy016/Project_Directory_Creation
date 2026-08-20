'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Making sure the shared drive is actually there before the app tries to use it.
 *
 * Practically every operation in this tool reads or writes G:. When Google Drive
 * for Desktop is not running, the drive simply is not mounted, and the failure
 * shows up as a scatter of confusing "client not found" and copy errors rather
 * than one clear message. So at launch: check, try to start Drive, check again,
 * and if it still is not there say so plainly.
 *
 * Everything impure is injected, so the decision logic can be tested without a
 * filesystem, a timer, or Google Drive installed.
 */

const DRIVE_FS_DIR = 'C:\\Program Files\\Google\\Drive File Stream';
const DRIVE_FS_DIR_X86 = 'C:\\Program Files (x86)\\Google\\Drive File Stream';

/**
 * Locate Google Drive for Desktop.
 *
 * The binary lives in a VERSIONED subfolder that changes with every update:
 *
 *   C:\Program Files\Google\Drive File Stream\129.0.1.0\GoogleDriveFS.exe
 *
 * so the version is discovered by listing the install directory and the path is
 * built from it -- never hardcoded. Several versions are usually present side by
 * side (this machine has 126.0.5.0, 127.0.1.0, 128.0.0.0, 129.0.1.0); the highest
 * wins, compared numerically so 129 beats 99.
 *
 * `launch.bat` at the top of the install is a version-independent fallback for
 * layouts where no versioned binary is found.
 */
function findDriveExecutable({ exists = fs.existsSync, readdir = fs.readdirSync } = {}) {
    for (const base of [DRIVE_FS_DIR, DRIVE_FS_DIR_X86]) {
        if (!exists(base)) {
            continue;
        }

        let entries;
        try {
            entries = readdir(base);
        } catch (err) {
            continue;
        }

        const versions = entries
            .filter((name) => /^\d+(\.\d+)*$/.test(name))
            .sort(compareVersionsDescending);

        for (const version of versions) {
            const candidate = path.join(base, version, 'GoogleDriveFS.exe');
            if (exists(candidate)) {
                return candidate;
            }
        }
    }

    for (const base of [DRIVE_FS_DIR, DRIVE_FS_DIR_X86]) {
        const launcher = path.join(base, 'launch.bat');
        if (exists(launcher)) {
            return launcher;
        }
    }

    return null;
}

/** Newest version first. Numeric per segment, so 129 sorts above 99. */
function compareVersionsDescending(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsB[i] || 0) - (partsA[i] || 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

/** Start Drive detached, so closing this app does not take it down with us. */
function launchDetached(executable) {
    const child = spawn(executable, [], {
        detached: true,
        stdio: 'ignore',
        // launch.bat needs a shell; harmless for the .exe fallback.
        shell: executable.toLowerCase().endsWith('.bat'),
    });
    child.unref();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check the drive, start Drive for Desktop if needed, and report what happened.
 *
 * @param {object}   options
 * @param {string}   options.driveRoot      path whose presence means "connected"
 * @param {number}   [options.timeoutMs]    how long to wait for the mount
 * @param {number}   [options.pollMs]       gap between checks while waiting
 * @param {Function} [options.exists]       injected fs.existsSync
 * @param {Function} [options.findExecutable]
 * @param {Function} [options.launch]       injected launcher
 * @param {Function} [options.wait]         injected sleep
 * @returns {Promise<{connected: boolean, outcome: string, message: string|null}>}
 */
async function ensureGoogleDrive({
    driveRoot,
    timeoutMs = 30000,
    pollMs = 1000,
    exists = fs.existsSync,
    findExecutable = findDriveExecutable,
    launch = launchDetached,
    wait = sleep,
    onStatus = () => {},
} = {}) {
    if (exists(driveRoot)) {
        return { connected: true, outcome: 'already-connected', message: null };
    }

    const executable = findExecutable();
    if (!executable) {
        return {
            connected: false,
            outcome: 'not-installed',
            message:
                `Google Drive for Desktop does not appear to be installed.\n\n` +
                `Install it, sign in, then restart Project Directory Creation.`,
        };
    }

    // The caller shows a spinner from here: launching and mounting take a while,
    // and the user should not be looking at a frozen dialog in the meantime.
    onStatus({ state: 'launching', executable });

    try {
        launch(executable);
    } catch (error) {
        return {
            connected: false,
            outcome: 'launch-failed',
            message:
                `Google Drive for Desktop could not be started automatically.\n\n` +
                `Please start it manually and restart Project Directory Creation.\n\n` +
                `(${error.message})`,
        };
    }

    onStatus({ state: 'waiting', executable });

    // Mounting takes a while, and longer still if the user has to sign in.
    //
    // Bounded by a poll COUNT rather than a wall-clock deadline. A clock-driven
    // loop spins as fast as the CPU allows whenever `wait` returns quickly, which
    // is exactly what happens under test -- and would happen in production too if
    // the timer were ever starved.
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollMs));
    for (let poll = 0; poll < maxPolls; poll += 1) {
        await wait(pollMs);
        if (exists(driveRoot)) {
            return { connected: true, outcome: 'launched', message: null };
        }
    }

    return {
        connected: false,
        outcome: 'timeout',
        message:
            `Google Drive for Desktop was started but the drive has not appeared yet. ` +
            `You may need to sign in using your browser\n\n` +
            `Creating or copying projects will fail until it is connected.`,
    };
}

/** The headline shown the instant a missing drive is detected. */
function notConnectedHeadline(driveRoot) {
    return `Your Google Drive (${driveRoot}) is not connected`;
}

/**
 * Keep watching for the drive after the initial attempt has given up.
 *
 * Signing in can take as long as it takes -- the browser flow, a password, MFA.
 * Closing the notice on a timer would leave the user with a stale warning and no
 * indication when the drive finally arrives, so this keeps polling until either
 * the drive appears or the caller stops caring (`shouldStop`, which is wired to
 * the status window being closed).
 *
 * @returns {Promise<boolean>} true once connected, false if stopped first
 */
async function watchForDrive({
    driveRoot,
    pollMs = 2000,
    exists = fs.existsSync,
    wait = sleep,
    shouldStop = () => false,
} = {}) {
    while (!shouldStop()) {
        if (exists(driveRoot)) {
            return true;
        }
        await wait(pollMs);
    }
    return false;
}

module.exports = {
    ensureGoogleDrive,
    watchForDrive,
    findDriveExecutable,
    compareVersionsDescending,
    notConnectedHeadline,
    isDriveConnected: (driveRoot, exists = fs.existsSync) => exists(driveRoot),
    DRIVE_FS_DIR,
    DRIVE_FS_DIR_X86,
};
