'use strict';

const { extractYearFromProjectName } = require('./project-name');

/**
 * Narrowing for the project search box. Pure: no fs, no DOM, no network.
 *
 * The index is every {client, project} pair found on the local AND shared drives,
 * built once per mode and filtered in memory as the user types. Both boxes narrow
 * together: Client "United Precast" + Project "2026" shows that client's 2026 jobs.
 *
 * WHY THE FILESYSTEM AND NOT ALGOLIA
 * ----------------------------------
 * The Tenders index lists jobs that were quoted, which is not the same set as the
 * folders that exist -- and it holds the client's NAME while every folder is named
 * by ES Reference, so each hit needed a second lookup to be usable. Reading the
 * drives answers the question actually being asked ("which project folders exist,
 * and where") and the client box matches the folder name directly.
 */

/** How a project's location is labelled in the list. */
const DRIVE_BOTH = 'Both';
const DRIVE_LOCAL = 'C';

/**
 * @param {{onLocal: boolean, onShared: boolean}} entry
 * @param {string} sharedSymbol 'G' or 'J', following the drive toggle
 */
function driveLabel(entry, sharedSymbol = 'G') {
    if (entry.onLocal && entry.onShared) {
        return DRIVE_BOTH;
    }
    return entry.onLocal ? DRIVE_LOCAL : sharedSymbol;
}

function tokenise(query) {
    return String(query == null ? '' : query)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

const matchesAll = (haystack, tokens) => tokens.every((token) => haystack.includes(token));

/**
 * Filter and rank the index.
 *
 * The client box is a separate, stricter filter than the project text: it matches
 * against the client folder only, so typing a client cannot accidentally be
 * satisfied by a project whose name happens to contain the same letters.
 *
 * Ranking:
 *   1. entries whose PROJECT name matches every token, ahead of ones that only
 *      matched via the client -- you typed a project, so project hits win
 *   2. newest year first, using the same extraction the tables sort by
 *   3. alphabetical, so the order is stable
 *
 * @param {Array<{client: string, project: string}>} entries
 * @param {string} clientText
 * @param {string} projectText
 * @param {{limit?: number}} [options] 0 means no cap
 */
function filterProjectIndex(entries, clientText, projectText, { limit = 50 } = {}) {
    const clientTokens = tokenise(clientText);
    const projectTokens = tokenise(projectText);

    const scored = [];

    for (const entry of entries || []) {
        const client = String(entry.client).toLowerCase();
        const project = String(entry.project).toLowerCase();

        if (clientTokens.length && !matchesAll(client, clientTokens)) {
            continue;
        }

        if (projectTokens.length === 0) {
            scored.push({ entry, projectHit: true });
            continue;
        }

        if (matchesAll(project, projectTokens)) {
            scored.push({ entry, projectHit: true });
        } else if (matchesAll(`${project} ${client}`, projectTokens)) {
            scored.push({ entry, projectHit: false });
        }
    }

    scored.sort((a, b) => {
        if (a.projectHit !== b.projectHit) {
            return a.projectHit ? -1 : 1;
        }

        const yearA = extractYearFromProjectName(a.entry.project);
        const yearB = extractYearFromProjectName(b.entry.project);
        if (yearA !== yearB) {
            if (yearA === null) return 1;
            if (yearB === null) return -1;
            return yearB - yearA;
        }

        return (
            a.entry.project.localeCompare(b.entry.project) ||
            a.entry.client.localeCompare(b.entry.client)
        );
    });

    const results = scored.map((entry) => entry.entry);
    return limit > 0 ? results.slice(0, limit) : results;
}

module.exports = { filterProjectIndex, driveLabel, tokenise, DRIVE_BOTH, DRIVE_LOCAL };
