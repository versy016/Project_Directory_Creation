'use strict';

const { roots } = require('../config/roots');
const { getSharedDrivePath, CLIENT_PROJECT, QUOTE_DIRECTORY } = require('./paths');

/**
 * Checking and repairing the PATHS inside FreeFileSync folder pairs.
 *
 * Sibling of ffs-repair, which fixes the <Changes>/<Differences> shape. This one
 * fixes what the Left and Right elements actually point at.
 *
 * WHAT CANONICAL MEANS
 * --------------------
 * Exactly what the app itself writes -- see resolvePairPaths in ffs-config:
 *
 *     C:\_Clients\United Precast\2026_UP1283_Regency_Rd_Broadview
 *     G:/Shared drives\United Precast\2026_UP1283_Regency_Rd_Broadview
 *
 * Note two things that look wrong and are not. The shared side keeps the forward
 * slashes getSharedDrivePath emits and then joins with a backslash, so a correct
 * pair has MIXED separators; normalising them would rewrite every healthy pair in
 * every config for no benefit. And there is no `_U` bucket here because United
 * Precast is a major client, and major clients sit directly under the shared base
 * while everyone else goes in a `_<Letter>` bucket. Which of those applies is the
 * single most common thing to get wrong by hand.
 *
 * WHAT IS AND IS NOT REPAIRED
 * ---------------------------
 * A pair is rebuilt when both sides agree on the client and project but a path is
 * malformed -- wrong bucket, wrong root, double-escaped entity, stray separators.
 *
 * A pair whose two sides name DIFFERENT clients or projects is reported and left
 * alone. There is no safe way to guess which side is right, and picking wrong
 * would point a live sync at the wrong folder.
 */

const OK = 'ok';
const FIXED = 'fixed';
const MISMATCH = 'mismatch';
const UNKNOWN_ROOT = 'unknown-root';

/** Undo XML escaping, repeatedly -- double-escaped paths are one of the faults. */
function unescapeXml(value) {
    let out = String(value == null ? '' : value);

    for (let pass = 0; pass < 5; pass += 1) {
        const next = out
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');

        if (next === out) {
            break;
        }
        out = next;
    }

    return out;
}

/** Escape once, the way generateFolderPairsXml does. */
const escapeXml = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;');

/** Trailing separators and surrounding whitespace are noise, not structure. */
const tidy = (value) => String(value == null ? '' : value).trim().replace(/[\\/]+$/, '');

/** The last two segments of a path: the client folder and the project folder. */
function clientAndProject(fullPath) {
    const parts = tidy(fullPath)
        .split(/[\\/]+/)
        .filter(Boolean);

    if (parts.length < 2) {
        return null;
    }
    return { client: parts[parts.length - 2], project: parts[parts.length - 1] };
}

/** Roots for a config file's mode. */
function rootsFor(mode, { jDrive = false } = {}) {
    if (mode === QUOTE_DIRECTORY) {
        return { local: roots.localAccounts, sharedFixed: roots.sharedQuotes };
    }
    if (jDrive) {
        return { local: roots.localClients, sharedFixed: roots.jDriveClients };
    }
    // Only the G client-projects case buckets by first letter, so the shared root
    // depends on the client rather than being fixed.
    return { local: roots.localClients, sharedFixed: null };
}

/**
 * What this pair's two paths should be.
 *
 * @returns {{local: string, shared: string}}
 */
function expectedPaths({ client, project, mode = CLIENT_PROJECT, jDrive = false, majorClients = [] }) {
    const { local, sharedFixed } = rootsFor(mode, { jDrive });
    const sharedRoot = sharedFixed || getSharedDrivePath(client, majorClients);

    return {
        local: `${local}\\${client}\\${project}`,
        shared: `${sharedRoot}\\${client}\\${project}`,
    };
}

const startsWithRoot = (candidate, root) =>
    tidy(candidate).toLowerCase().startsWith(tidy(root).toLowerCase());

/**
 * Check one pair's paths, and say what they should be.
 *
 * @param {{left: string, right: string}} pair raw (still XML-escaped) values
 * @param {{mode?: string, jDrive?: boolean, majorClients?: string[]}} context
 * @returns {{status: string, left?: string, right?: string, client?: string,
 *            project?: string, reason?: string}}
 */
function checkPair({ left, right }, context = {}) {
    const rawLeft = unescapeXml(left);
    const rawRight = unescapeXml(right);

    const { local: localRoot } = rootsFor(context.mode, context);

    // Either side may be the local one -- the direction decides the order.
    const leftIsLocal = startsWithRoot(rawLeft, localRoot);
    const rightIsLocal = startsWithRoot(rawRight, localRoot);

    if (leftIsLocal === rightIsLocal) {
        return {
            status: UNKNOWN_ROOT,
            reason: leftIsLocal
                ? 'both sides point at the local drive'
                : `neither side is under ${localRoot}`,
        };
    }

    const localSide = leftIsLocal ? rawLeft : rawRight;
    const sharedSide = leftIsLocal ? rawRight : rawLeft;

    const fromLocal = clientAndProject(localSide);
    const fromShared = clientAndProject(sharedSide);

    if (!fromLocal || !fromShared) {
        return { status: UNKNOWN_ROOT, reason: 'a path is too short to name a project' };
    }

    if (
        fromLocal.client !== fromShared.client ||
        fromLocal.project !== fromShared.project
    ) {
        // Deliberately not repaired: there is no safe way to tell which side is
        // the mistake, and choosing wrong aims a live sync at the wrong folder.
        return {
            status: MISMATCH,
            reason:
                `the two sides name different folders -- ` +
                `${fromLocal.client}\\${fromLocal.project} vs ` +
                `${fromShared.client}\\${fromShared.project}`,
            client: fromLocal.client,
            project: fromLocal.project,
        };
    }

    const expected = expectedPaths({
        client: fromLocal.client,
        project: fromLocal.project,
        mode: context.mode,
        jDrive: context.jDrive,
        majorClients: context.majorClients,
    });

    // Preserve which side is which: the order encodes the sync direction.
    // Compared as they appear IN THE FILE, not unescaped -- a double-escaped
    // path unescapes to the correct thing and would otherwise look fine.
    const wantLeft = escapeXml(leftIsLocal ? expected.local : expected.shared);
    const wantRight = escapeXml(leftIsLocal ? expected.shared : expected.local);

    if (left === wantLeft && right === wantRight) {
        return { status: OK, client: fromLocal.client, project: fromLocal.project };
    }

    return {
        status: FIXED,
        left: wantLeft,
        right: wantRight,
        client: fromLocal.client,
        project: fromLocal.project,
        reason: describeDifference(
            { was: left, want: wantLeft },
            { was: right, want: wantRight }
        ),
    };
}

/** A short human reason, so the report says more than "it changed". */
function describeDifference(leftSide, rightSide) {
    const reasons = [];

    for (const side of [leftSide, rightSide]) {
        if (side.was === side.want) {
            continue;
        }
        if (side.was.includes('&amp;amp;')) {
            reasons.push('double-escaped &');
        } else if (tidy(side.was) !== side.was) {
            reasons.push('stray whitespace or trailing separator');
        } else if (side.was.replace(/[\\/]+/g, '\\') === side.want.replace(/[\\/]+/g, '\\')) {
            reasons.push('separators');
        } else {
            reasons.push('wrong folder root');
        }
    }

    return [...new Set(reasons)].join(', ') || 'path did not match the expected form';
}

module.exports = {
    checkPair,
    expectedPaths,
    clientAndProject,
    unescapeXml,
    escapeXml,
    STATUS: { OK, FIXED, MISMATCH, UNKNOWN_ROOT },
};
