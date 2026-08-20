'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    FILTERS,
    SORTS,
    PAGE_SIZE,
    DEFAULT_VIEW,
    applyView,
    countBuckets,
    atRiskProjects,
    pairedProjectNames,
    projectNameFromPath,
    sortProjectsBy,
} = require('../../src/core/project-filter');

const PARTITION = {
    common: ['2024_Shared', '2022_AlsoShared'],
    onlyC: ['2023_LocalOnly', 'Archive'],
    onlyG: ['2021_SharedOnly'],
};

/** Only one of the shared projects actually has a folder pair. */
const CONFIG = [
    {
        cDriveProject: 'C:\\_Clients\\ACME\\2024_Shared',
        gDriveProject: 'G:/Shared drives/_A\\ACME\\2024_Shared',
    },
];

const paired = pairedProjectNames(CONFIG);

test('pairedProjectNames reads the project off both sides of a pair', () => {
    assert.deepEqual([...paired], ['2024_Shared']);
});

test('pairing matches the whole folder name, not a substring', () => {
    // The substring test used elsewhere reports a pair for 2024_A when the config
    // only holds 2024_AB -- marking an unsynced project as synced, which is the
    // wrong way round for something meant to flag risk.
    const names = pairedProjectNames([
        { cDriveProject: 'C:\\_Clients\\ACME\\2024_AB', gDriveProject: 'G:\\x\\2024_AB' },
    ]);

    assert.ok(names.has('2024_AB'));
    assert.ok(!names.has('2024_A'), 'a shorter name must not count as paired');
});

test('projectNameFromPath handles both separators and mixed paths', () => {
    assert.equal(projectNameFromPath('C:\\_Clients\\ACME\\2024_X'), '2024_X');
    assert.equal(projectNameFromPath('G:/Shared drives/_A\\ACME\\2024_X'), '2024_X');
    assert.equal(projectNameFromPath(''), '');
    assert.equal(projectNameFromPath(null), '');
});

test('counts are reported for every filter', () => {
    assert.deepEqual(countBuckets(PARTITION, paired), {
        all: 5,
        synced: 2,
        localOnly: 2,
        sharedOnly: 1,
        notSyncing: 4, // everything except 2024_Shared
    });
});

test('at-risk means local-only AND unpaired', () => {
    // 2024_Shared is paired, and the shared-only project is already on the server.
    // Only a local-only project with no pair can actually be lost.
    assert.deepEqual(atRiskProjects(PARTITION, paired), ['2023_LocalOnly', 'Archive']);

    const allPaired = pairedProjectNames([
        { cDriveProject: 'C:\\x\\2023_LocalOnly', gDriveProject: '' },
        { cDriveProject: 'C:\\x\\Archive', gDriveProject: '' },
    ]);
    assert.deepEqual(atRiskProjects(PARTITION, allPaired), []);
});

/**
 * The middle sync column is positioned against C-drive rows by index, so the
 * shared projects have to lead both columns in the same order under every filter.
 */
test('shared projects lead both columns under every filter', () => {
    for (const filter of Object.values(FILTERS)) {
        const view = applyView(PARTITION, { filter, paired });

        for (let i = 0; i < view.common.length; i += 1) {
            assert.equal(view.c[i], view.common[i], `${filter}: C column misaligned at ${i}`);
            assert.equal(view.g[i], view.common[i], `${filter}: G column misaligned at ${i}`);
        }
    }
});

test('the default view shows everything, shared first', () => {
    const view = applyView(PARTITION, { paired });

    assert.deepEqual(view.c, ['2024_Shared', '2022_AlsoShared', '2023_LocalOnly', 'Archive']);
    assert.deepEqual(view.g, ['2024_Shared', '2022_AlsoShared', '2021_SharedOnly']);
});

test('Synced shows only projects on both drives', () => {
    const view = applyView(PARTITION, { filter: FILTERS.SYNCED, paired });

    assert.deepEqual(view.c, ['2024_Shared', '2022_AlsoShared']);
    assert.deepEqual(view.g, ['2024_Shared', '2022_AlsoShared']);
});

test('Local only empties the shared column', () => {
    const view = applyView(PARTITION, { filter: FILTERS.LOCAL_ONLY, paired });

    assert.deepEqual(view.c, ['2023_LocalOnly', 'Archive']);
    assert.deepEqual(view.g, []);
    assert.deepEqual(view.common, [], 'no sync controls when nothing is on both sides');
});

test('Shared only empties the local column', () => {
    const view = applyView(PARTITION, { filter: FILTERS.SHARED_ONLY, paired });

    assert.deepEqual(view.c, []);
    assert.deepEqual(view.g, ['2021_SharedOnly']);
});

test('Not syncing hides projects that already have a folder pair', () => {
    const view = applyView(PARTITION, { filter: FILTERS.NOT_SYNCING, paired });

    assert.ok(!view.c.includes('2024_Shared'), '2024_Shared is paired and should be hidden');
    assert.deepEqual(view.c, ['2022_AlsoShared', '2023_LocalOnly', 'Archive']);
    assert.deepEqual(view.g, ['2022_AlsoShared', '2021_SharedOnly']);
});

test('sorting: newest year first by default, undated last', () => {
    assert.deepEqual(
        sortProjectsBy(['2019_A', 'Archive', '2030_B', '2024_C'], SORTS.YEAR_DESC),
        ['2030_B', '2024_C', '2019_A', 'Archive']
    );
});

test('sorting: oldest first still leaves undated at the bottom', () => {
    // Undated folders are nearly always admin. Burying real projects under them
    // would make "oldest first" useless.
    assert.deepEqual(
        sortProjectsBy(['2019_A', 'Archive', '2030_B', '2024_C'], SORTS.YEAR_ASC),
        ['2019_A', '2024_C', '2030_B', 'Archive']
    );
});

test('sorting: by name, both directions', () => {
    assert.deepEqual(sortProjectsBy(['b', 'C', 'a'], SORTS.NAME_ASC), ['a', 'b', 'C']);
    assert.deepEqual(sortProjectsBy(['b', 'C', 'a'], SORTS.NAME_DESC), ['C', 'b', 'a']);
});

test('the sort applies to every bucket, not just the shared one', () => {
    const view = applyView(PARTITION, { sort: SORTS.NAME_ASC, paired });

    assert.deepEqual(view.c, ['2022_AlsoShared', '2024_Shared', '2023_LocalOnly', 'Archive']);
    // shared block sorted, then the local-only block sorted -- not one flat sort
    assert.deepEqual(view.g, ['2022_AlsoShared', '2024_Shared', '2021_SharedOnly']);
});

test('sorting does not mutate the caller', () => {
    const input = ['2019_A', '2030_B'];
    const snapshot = [...input];
    sortProjectsBy(input, SORTS.YEAR_DESC);
    assert.deepEqual(input, snapshot);
});

test('an empty partition produces empty columns and zero counts', () => {
    const view = applyView({}, { paired: new Set() });

    assert.deepEqual(view.c, []);
    assert.deepEqual(view.g, []);
    assert.equal(view.counts.all, 0);
    assert.deepEqual(view.atRisk, []);
});

test('an unknown filter or sort falls back to the default view', () => {
    const view = applyView(PARTITION, { filter: 'nonsense', sort: 'nonsense', paired });
    assert.deepEqual(view.c, applyView(PARTITION, { paired }).c);
});

/**
 * Paging. A client with hundreds of projects should not render hundreds of rows,
 * but the cap must not break the alignment invariant -- both columns are capped
 * to the same row count so they keep the identical shared prefix.
 */
const BIG = {
    common: ['2024_C1', '2024_C2', '2024_C3'],
    onlyC: Array.from({ length: 20 }, (_, i) => `2023_L${String(i).padStart(2, '0')}`),
    onlyG: Array.from({ length: 5 }, (_, i) => `2022_S${i}`),
};

test('no limit shows everything', () => {
    const view = applyView(BIG, { paired: new Set() });

    assert.equal(view.c.length, 23);
    assert.equal(view.total, 23);
    assert.equal(view.hasMore, false);
});

test('a limit caps both columns and reports what is left', () => {
    const view = applyView(BIG, { limit: 10, paired: new Set() });

    assert.equal(view.c.length, 10);
    assert.equal(view.shown, 10);
    assert.equal(view.total, 23);
    assert.equal(view.hasMore, true);
});

test('paging keeps the columns aligned', () => {
    for (const limit of [1, 2, 3, 4, 10, 23, 100]) {
        const view = applyView(BIG, { limit, paired: new Set() });

        for (let i = 0; i < view.common.length; i += 1) {
            assert.equal(view.c[i], view.common[i], `limit ${limit}: C misaligned at ${i}`);
            assert.equal(view.g[i], view.common[i], `limit ${limit}: G misaligned at ${i}`);
        }
    }
});

test('a limit below the shared count trims the sync controls to match', () => {
    // Two rows visible, both shared -> exactly two direction cells, or the
    // controls would line up against rows that are not on screen.
    const view = applyView(BIG, { limit: 2, paired: new Set() });

    assert.deepEqual(view.c, ['2024_C1', '2024_C2']);
    assert.deepEqual(view.g, ['2024_C1', '2024_C2']);
    assert.equal(view.common.length, 2);
});

test('the shorter column is not padded to the limit', () => {
    // G only has 3 shared + 5 exclusive; a limit of 10 cannot invent rows.
    const view = applyView(BIG, { limit: 10, paired: new Set() });

    assert.equal(view.g.length, 8);
    assert.equal(view.shown, 10, 'shown reflects the longer column');
});

test('hasMore goes false once the limit reaches the total', () => {
    assert.equal(applyView(BIG, { limit: 22, paired: new Set() }).hasMore, true);
    assert.equal(applyView(BIG, { limit: 23, paired: new Set() }).hasMore, false);
    assert.equal(applyView(BIG, { limit: 999, paired: new Set() }).hasMore, false);
});

test('the limit applies after filtering, not before', () => {
    // Otherwise a filter could show fewer rows than the page size while still
    // claiming there was more to see.
    const view = applyView(BIG, { filter: FILTERS.SHARED_ONLY, limit: 10, paired: new Set() });

    assert.equal(view.total, 5, 'only the shared-only bucket counts');
    assert.equal(view.hasMore, false);
    assert.deepEqual(view.c, []);
});

test('DEFAULT_VIEW is the documented starting point', () => {
    assert.deepEqual({ ...DEFAULT_VIEW }, {
        filter: FILTERS.ALL,
        sort: SORTS.YEAR_DESC,
        limit: PAGE_SIZE,
    });
});
