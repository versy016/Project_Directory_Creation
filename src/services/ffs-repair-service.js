'use strict';

const fs = require('fs');
const path = require('path');

const { roots } = require('../config/roots');
const { repairConfig, repairPaths } = require('../core/ffs-repair');
const { CLIENT_PROJECT, QUOTE_DIRECTORY } = require('../core/paths');

/**
 * Scan the FreeFileSync configs this app maintains and repair broken folder pairs.
 *
 * See src/core/ffs-repair for what "broken" means and why. In short: ticking
 * "use database file to detect changes" rewrites a pair into a form this app
 * cannot read, and one such pair used to make every pair in the file invisible.
 *
 * The originals are copied to `<name>.bak` before anything is written, because
 * this touches a file the user's real sync depends on and they should be able to
 * put it back without involving anyone.
 */

/**
 * The configs this app maintains, and what each one's paths should look like.
 * The filename is what tells us which roots apply -- there is nothing inside the
 * file that says whether it is the quotes config or the J drive one.
 */
const CONFIG_FILES = [
    { name: 'SyncSettings.ffs_gui', mode: CLIENT_PROJECT, jDrive: false },
    { name: 'SyncSettings_Quotes.ffs_gui', mode: QUOTE_DIRECTORY, jDrive: false },
    { name: 'SyncSettingsJdrive.ffs_gui', mode: CLIENT_PROJECT, jDrive: true },
];

/**
 * The major-clients list, read here rather than taken from renderer state --
 * this runs in the main process at launch. A UTF-8 BOM is stripped before
 * parsing: JSON.parse chokes on one, and the file is hand-edited on the share
 * where a Notepad save can easily add it (bug #26).
 */
function readMajorClients(io = fs) {
    try {
        if (!io.existsSync(roots.majorClientsFile)) {
            return [];
        }
        const raw = io.readFileSync(roots.majorClientsFile, 'utf-8').replace(/^﻿/, '');
        const parsed = JSON.parse(raw);
        return (parsed.majorClients || []).map((name) => String(name).toUpperCase());
    } catch (error) {
        console.error('Could not read majorClients.json:', error);
        return [];
    }
}

/**
 * @param {object} [options]
 * @param {string} [options.configDir]  defaults to the configured FreeFileSync dir
 * @param {string[]} [options.files]
 * @param {object} [options.io]         injected for testing
 * @returns {{repaired: Array<{file: string, backup: string, pairs: Array}>, scanned: string[], errors: Array}}
 */
function repairSyncConfigs({ configDir = roots.ffsConfigDir, files = CONFIG_FILES, io = fs } = {}) {
    const repaired = [];
    const scanned = [];
    const errors = [];
    const problems = [];

    const majorClients = readMajorClients(io);

    for (const config of files) {
        const file = path.join(configDir, config.name);

        if (!io.existsSync(file)) {
            continue;
        }

        scanned.push(config.name);

        try {
            const original = io.readFileSync(file, 'utf-8');

            // Two independent faults, repaired in one pass: the sync-mode shape,
            // then what the paths point at.
            const shape = repairConfig(original);
            const paths = repairPaths(shape.xml, {
                mode: config.mode,
                jDrive: config.jDrive,
                majorClients,
            });

            for (const problem of paths.problems) {
                problems.push({ file: config.name, ...problem });
            }

            if (shape.repairs.length === 0 && paths.repairs.length === 0) {
                continue;
            }

            // Back up first. If this throws we have not touched the original.
            const backup = `${file}.bak`;
            io.writeFileSync(backup, original, 'utf-8');
            io.writeFileSync(file, paths.xml, 'utf-8');

            repaired.push({
                file: config.name,
                backup,
                pairs: shape.repairs,
                paths: paths.repairs,
            });
        } catch (error) {
            console.error(`Could not repair ${config.name}:`, error);
            errors.push({ file: config.name, message: error.message });
        }
    }

    return { repaired, scanned, errors, problems };
}

/**
 * Turn a repair report into the message shown to the user.
 *
 * Names every pair that changed and which direction it was restored to, because
 * the direction is inferred and the user is the only one who knows what they
 * actually wanted. Hence "please review".
 *
 * @returns {string|null} null when there is nothing worth saying
 */
function describeRepairs({ repaired = [], errors = [], problems = [] }) {
    if (repaired.length === 0 && errors.length === 0 && problems.length === 0) {
        return null;
    }

    const lines = [];

    const shapeTotal = repaired.reduce((sum, entry) => sum + entry.pairs.length, 0);
    const pathTotal = repaired.reduce((sum, entry) => sum + (entry.paths || []).length, 0);
    const total = shapeTotal + pathTotal;

    if (total > 0) {
        // One paragraph per idea, left to wrap naturally. Hard-wrapping it here
        // fought the modal's own wrapping and produced ragged half-lines.
        lines.push(
            `${total} FreeFileSync folder ${total === 1 ? 'pair was' : 'pairs were'} repaired.`,
            ''
        );

        if (shapeTotal > 0) {
            lines.push(
                `${shapeTotal} had been switched to "use database file to detect changes", ` +
                    'which this app cannot read. While any pair is in that state, no project ' +
                    'shows as synced.',
                ''
            );
        }

        if (pathTotal > 0) {
            lines.push(
                `${pathTotal} pointed at the wrong folder -- a mis-typed path, the wrong ` +
                    'shared-drive letter folder, or a stray symbol.',
                ''
            );
        }

        for (const entry of repaired) {
            lines.push(`${entry.file}:`);

            for (const pair of entry.pairs) {
                lines.push(`  • ${projectLabel(pair.left)}  (sync mode restored to ${pair.becomes})`);
            }
            for (const pair of entry.paths || []) {
                lines.push(`  • ${pair.client} \\ ${pair.project}  (path fixed: ${pair.reason})`);
            }

            lines.push(`  backup: ${path.basename(entry.backup)}`);
            lines.push('');
        }

        lines.push('Please review these pairs in FreeFileSync.');
    }

    // Reported, not repaired: guessing which side is wrong could aim a live sync
    // at the wrong folder, so these need a person.
    if (problems.length > 0) {
        lines.push('', `${problems.length} pair(s) need checking by hand:`);
        for (const problem of problems) {
            lines.push(`  • ${problem.file}: ${problem.reason}`);
        }
    }

    if (errors.length > 0) {
        lines.push('', 'Could not be repaired:');
        for (const error of errors) {
            lines.push(`  • ${error.file}: ${error.message}`);
        }
    }

    return lines.join('\n').trim();
}

/** `C:\_Clients\Sarah Build\2023_X` -> `Sarah Build \ 2023_X`, which is what a user recognises. */
function projectLabel(fullPath) {
    if (!fullPath) {
        return '(unknown)';
    }
    const parts = String(fullPath).split(/[\\/]+/).filter(Boolean);
    return parts.slice(-2).join(' \\ ') || fullPath;
}

module.exports = {
    repairSyncConfigs,
    describeRepairs,
    readMajorClients,
    projectLabel,
    CONFIG_FILES,
};
