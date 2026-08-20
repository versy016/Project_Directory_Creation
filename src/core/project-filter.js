'use strict';

const { extractYearFromProjectName } = require('./project-name');
const { tokenise } = require('./project-index');

/**
 * Filtering and sorting for the two project tables. Pure: no fs, no DOM.
 *
 * THE ALIGNMENT INVARIANT
 * -----------------------
 * The middle sync column is positioned against C-drive rows BY INDEX
 * (alignDirectionCellsWithRows), so row i on the left must be the same project as
 * row i on the right. Every view below therefore emits the shared projects first,
 * in the same order, in both columns -- exclusives only ever follow. Break that
 * and the direction dropdowns silently line up against the wrong projects.
 */

const FILTERS = {
    ALL: 'all',
    SYNCED: 'synced',
    LOCAL_ONLY: 'localOnly',
    SHARED_ONLY: 'sharedOnly',
    NOT_SYNCING: 'notSyncing',
};

const SORTS = {
    YEAR_DESC: 'yearDesc',
    YEAR_ASC: 'yearAsc',
    NAME_ASC: 'nameAsc',
    NAME_DESC: 'nameDesc',
};

/** Rows shown before "Show more", and how many each press adds. */
const PAGE_SIZE = 10;

/** The view a fresh search starts from. */
const DEFAULT_VIEW = Object.freeze({
    filter: FILTERS.ALL,
    sort: SORTS.YEAR_DESC,
    limit: PAGE_SIZE,
});

/** The last path segment: `C:\_Clients\ACME\2024_X` -> `2024_X`. */
function projectNameFromPath(fullPath) {
    const parts = String(fullPath || '')
        .split(/[\\/]+/)
        .filter(Boolean);
    return parts[parts.length - 1] || '';
}

/**
 * Which projects have a folder pair, by name.
 *
 * Matches on the final path segment rather than a substring of the whole path.
 * The substring test used elsewhere reports a pair for `2024_A` when the config
 * only contains `2024_AB`, which would mark an unsynced project as synced -- the
 * wrong way round for something meant to flag risk.
 *
 * @param {Array<{cDriveProject: string, gDriveProject: string}>} configData
 * @returns {Set<string>}
 */
function pairedProjectNames(configData) {
    const names = new Set();

    for (const pair of configData || []) {
        for (const side of [pair.cDriveProject, pair.gDriveProject]) {
            const name = projectNameFromPath(side);
            if (name) {
                names.add(name);
            }
        }
    }

    return names;
}

/**
 * Narrow a partition to the projects matching the search box.
 *
 * Applied BEFORE the filter, sort, paging, counts and at-risk warning, so every
 * number on screen describes the same set of rows the tables are showing. The
 * alternative -- narrowing only the rendered arrays -- leaves the pager claiming
 * "showing 3 of 57" while three rows exist, which reads as a paging bug.
 *
 * Tokenising matches the search dropdown (core/project-index), so a query that
 * suggests a project also keeps that project in the tables. Space-separated terms
 * are AND-ed and order does not matter: "regency 2026" finds
 * `2026_UP1283_Regency_Rd`.
 *
 * @param {{common: string[], onlyC: string[], onlyG: string[]}} partition
 * @param {string} query raw text from the project search box
 */
function narrowPartition(partition, query) {
    const tokens = tokenise(query);
    const { common = [], onlyC = [], onlyG = [] } = partition || {};

    if (tokens.length === 0) {
        return { common, onlyC, onlyG };
    }

    const keep = (name) => {
        const haystack = String(name).toLowerCase();
        return tokens.every((token) => haystack.includes(token));
    };

    return {
        common: common.filter(keep),
        onlyC: onlyC.filter(keep),
        onlyG: onlyG.filter(keep),
    };
}

/** Row count for a partition, counting the way the tables render it. */
function totalRows({ common = [], onlyC = [], onlyG = [] } = {}) {
    return Math.max(common.length + onlyC.length, common.length + onlyG.length);
}

function comparatorFor(sort) {
    if (sort === SORTS.NAME_ASC) {
        return (a, b) => a.localeCompare(b);
    }
    if (sort === SORTS.NAME_DESC) {
        return (a, b) => b.localeCompare(a);
    }

    const newestFirst = sort !== SORTS.YEAR_ASC;

    return (a, b) => {
        const yearA = extractYearFromProjectName(a);
        const yearB = extractYearFromProjectName(b);

        // Undated projects sink to the bottom either way -- they are almost always
        // admin folders, and burying them under "oldest first" would be unhelpful.
        if (yearA === null && yearB === null) {
            return a.localeCompare(b);
        }
        if (yearA === null) return 1;
        if (yearB === null) return -1;

        if (yearA !== yearB) {
            return newestFirst ? yearB - yearA : yearA - yearB;
        }
        return a.localeCompare(b);
    };
}

const sortProjectsBy = (projects, sort) => [...projects].sort(comparatorFor(sort));

/**
 * How many projects each filter would show. Rendered onto the chips so the counts
 * are visible without clicking through them.
 */
function countBuckets(partition, paired) {
    const { common = [], onlyC = [], onlyG = [] } = partition || {};
    const unpaired = (name) => !paired.has(name);

    return {
        [FILTERS.ALL]: common.length + onlyC.length + onlyG.length,
        [FILTERS.SYNCED]: common.length,
        [FILTERS.LOCAL_ONLY]: onlyC.length,
        [FILTERS.SHARED_ONLY]: onlyG.length,
        [FILTERS.NOT_SYNCING]:
            common.filter(unpaired).length +
            onlyC.filter(unpaired).length +
            onlyG.filter(unpaired).length,
    };
}

/**
 * Projects that exist ONLY on the local drive and have no folder pair.
 *
 * These are the ones that will never reach the shared drive on their own -- one
 * failed hard drive from being gone. Surfaced separately from the filters because
 * it is a warning, not a view.
 */
function atRiskProjects(partition, paired) {
    return (partition.onlyC || []).filter((name) => !paired.has(name));
}

/**
 * Apply a filter and sort, returning what each column should render.
 *
 * @param {{common: string[], onlyC: string[], onlyG: string[]}} partition
 * @param {object} view
 * @param {string}  [view.filter]
 * @param {string}  [view.sort]
 * @param {Set<string>} [view.paired]
 * @param {number}  [view.limit] rows per column; 0 or Infinity shows everything
 * @param {string}  [view.query] search-box text; narrows all three buckets first
 * @returns {{c: string[], g: string[], common: string[], counts: object,
 *           atRisk: string[], total: number, shown: number, hasMore: boolean,
 *           query: string, totalUnfiltered: number}}
 */
function applyView(
    partition,
    { filter = FILTERS.ALL, sort = SORTS.YEAR_DESC, paired, limit = 0, query = '' } = {}
) {
    const pairedNames = paired || new Set();

    // The search text defines the working set; everything below derives from it.
    const narrowed = narrowPartition(partition, query);
    const { common, onlyC, onlyG } = narrowed;

    const sorted = {
        common: sortProjectsBy(common, sort),
        onlyC: sortProjectsBy(onlyC, sort),
        onlyG: sortProjectsBy(onlyG, sort),
    };

    let shared = sorted.common;
    let localOnly = sorted.onlyC;
    let sharedOnly = sorted.onlyG;

    if (filter === FILTERS.SYNCED) {
        localOnly = [];
        sharedOnly = [];
    } else if (filter === FILTERS.LOCAL_ONLY) {
        shared = [];
        sharedOnly = [];
    } else if (filter === FILTERS.SHARED_ONLY) {
        shared = [];
        localOnly = [];
    } else if (filter === FILTERS.NOT_SYNCING) {
        const unpaired = (name) => !pairedNames.has(name);
        shared = shared.filter(unpaired);
        localOnly = localOnly.filter(unpaired);
        sharedOnly = sharedOnly.filter(unpaired);
    }

    // Shared projects lead both columns -- see the alignment invariant above.
    const fullC = [...shared, ...localOnly];
    const fullG = [...shared, ...sharedOnly];

    const total = Math.max(fullC.length, fullG.length);
    const cap = limit > 0 ? limit : total;

    // Both columns are capped at the same row count, so they keep the identical
    // shared prefix and the sync controls still line up. The direction column is
    // capped to however many shared rows actually made it in.
    const c = fullC.slice(0, cap);
    const g = fullG.slice(0, cap);

    return {
        c,
        g,
        common: shared.slice(0, cap),
        // Counts and the at-risk warning describe the narrowed set, not the whole
        // client -- see narrowPartition. `totalUnfiltered` is what the search text
        // is hiding, so the UI can say "4 of 57".
        counts: countBuckets(narrowed, pairedNames),
        atRisk: atRiskProjects(narrowed, pairedNames),
        total,
        shown: Math.max(c.length, g.length),
        hasMore: total > cap,
        query: String(query || '').trim(),
        totalUnfiltered: totalRows(partition),
    };
}

module.exports = {
    FILTERS,
    SORTS,
    PAGE_SIZE,
    DEFAULT_VIEW,
    applyView,
    narrowPartition,
    countBuckets,
    atRiskProjects,
    pairedProjectNames,
    projectNameFromPath,
    sortProjectsBy,
};
