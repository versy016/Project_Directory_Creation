'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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

// ---------------------------------------------------------------------------
// Narrowing by the project search box.
// ---------------------------------------------------------------------------

test('narrowPartition filters every bucket, case-insensitively', () => {
    assert.deepEqual(narrowPartition(PARTITION, 'shared'), {
        common: ['2024_Shared', '2022_AlsoShared'],
        onlyC: [],
        onlyG: ['2021_SharedOnly'],
    });

    assert.deepEqual(narrowPartition(PARTITION, 'ONLY'), {
        common: [],
        onlyC: ['2023_LocalOnly'],
        onlyG: ['2021_SharedOnly'],
    });
});

test('an empty or blank query narrows nothing', () => {
    for (const query of ['', '   ', null, undefined]) {
        assert.deepEqual(narrowPartition(PARTITION, query), {
            common: PARTITION.common,
            onlyC: PARTITION.onlyC,
            onlyG: PARTITION.onlyG,
        });
    }
});

test('multiple terms are AND-ed, and order does not matter', () => {
    // The same rule the search dropdown uses, so a query that suggests a project
    // also keeps that project in the tables.
    assert.deepEqual(narrowPartition(PARTITION, 'also shared').common, ['2022_AlsoShared']);
    assert.deepEqual(narrowPartition(PARTITION, 'shared also').common, ['2022_AlsoShared']);
    assert.deepEqual(narrowPartition(PARTITION, 'also 2021').common, []);
});

test('a query narrows both columns and still leads with the shared projects', () => {
    const view = applyView(PARTITION, { query: 'shared', paired });

    assert.deepEqual(view.c, ['2024_Shared', '2022_AlsoShared']);
    assert.deepEqual(view.g, ['2024_Shared', '2022_AlsoShared', '2021_SharedOnly']);

    // The alignment invariant has to survive narrowing: the sync column is
    // positioned against C-drive rows by index.
    assert.equal(view.c[0], view.g[0]);
    assert.equal(view.c[1], view.g[1]);
    assert.deepEqual(view.common, ['2024_Shared', '2022_AlsoShared']);
});

test('counts and the at-risk warning describe the narrowed set', () => {
    const all = applyView(PARTITION, { paired });
    assert.deepEqual(all.atRisk, ['2023_LocalOnly', 'Archive']);
    assert.equal(all.counts.all, 5);

    const narrowed = applyView(PARTITION, { query: 'only', paired });

    // Otherwise the pager reads "showing 1 of 4" beside a warning about 2
    // projects, and neither number matches the rows on screen.
    assert.deepEqual(narrowed.atRisk, ['2023_LocalOnly']);
    assert.equal(narrowed.counts.all, 2);
    assert.equal(narrowed.counts.localOnly, 1);
    assert.equal(narrowed.counts.sharedOnly, 1);
});

test('totalUnfiltered reports what the query is hiding', () => {
    const narrowed = applyView(PARTITION, { query: '2024', paired });

    assert.equal(narrowed.total, 1);
    assert.equal(narrowed.totalUnfiltered, 4);
    assert.equal(narrowed.query, '2024');
});

test('a query matching nothing empties both columns rather than falling back', () => {
    const view = applyView(PARTITION, { query: 'no-such-project', paired });

    assert.deepEqual(view.c, []);
    assert.deepEqual(view.g, []);
    assert.deepEqual(view.common, []);
    assert.equal(view.total, 0);
    assert.equal(view.hasMore, false);
    assert.equal(view.totalUnfiltered, 4, 'the client still has projects; they just do not match');
});

test('the reported query is trimmed, and absent when there is none', () => {
    assert.equal(applyView(PARTITION, { query: '  2024  ' }).query, '2024');
    assert.equal(applyView(PARTITION, {}).query, '');
    assert.equal(applyView(PARTITION, { query: '   ' }).query, '');
});

test('paging counts the matches, not the whole client', () => {
    const many = {
        common: [],
        onlyC: Array.from({ length: 25 }, (_, i) => '2024_Match' + String(i).padStart(2, '0')),
        onlyG: ['2024_Other'],
    };

    const view = applyView(many, { query: 'match', limit: PAGE_SIZE });

    assert.equal(view.total, 25, 'the unmatched G project is not part of the list');
    assert.equal(view.shown, PAGE_SIZE);
    assert.equal(view.hasMore, true);
    assert.ok(!view.c.includes('2024_Other'));

    // Both totals count ROWS -- max(C, G) -- because the columns render side by
    // side, which is what `total` has always meant. Here C alone is already 25
    // rows long, so hiding the single G-only project does not shorten the table.
    // The two numbers in "showing N of M" must measure the same thing.
    assert.equal(view.totalUnfiltered, 25);
    assert.equal(applyView(many, {}).total, 25);
});

test('a query composes with sort rather than overriding it', () => {
    const oldest = applyView(PARTITION, { query: 'shared', sort: SORTS.YEAR_ASC });
    assert.deepEqual(oldest.c, ['2022_AlsoShared', '2024_Shared']);

    const byName = applyView(PARTITION, { query: 'shared', sort: SORTS.NAME_ASC });
    assert.deepEqual(byName.c, ['2022_AlsoShared', '2024_Shared']);
});
