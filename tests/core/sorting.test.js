'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const legacy = require('../legacy/legacy-implementations');
const { sortProjects, partitionProjects } = require('../../src/core/sorting');

const MIXED = [
  'Archive',
  '2019_Older',
  'E20240123_Bridge',
  '2024_Roadworks',
  'zzz_last',
  '2030_Future',
  'C12345678_NoYear',
  '2024_Another',
];

const LISTS = [
  [[], []],
  [MIXED, []],
  [[], MIXED],
  [MIXED, MIXED],
  [MIXED.slice(0, 4), MIXED.slice(2)],
  [['2024_A', '2024_B'], ['2024_B', '2024_C']],
  [['Only', 'Undated'], ['Undated', 'Other']],
];

test('sortProjects matches the legacy implementation', () => {
  for (const [input] of LISTS) {
    // The legacy version sorts in place, so it gets its own copy.
    assert.deepEqual(sortProjects([...input]), legacy.sortProjects([...input]));
  }
});

test('sortProjects: documented behaviour', async (t) => {
  await t.test('dated projects come first, newest year first', () => {
    assert.deepEqual(sortProjects(['2019_A', '2030_B', '2024_C']), [
      '2030_B',
      '2024_C',
      '2019_A',
    ]);
  });

  await t.test('undated projects sink below dated ones', () => {
    assert.deepEqual(sortProjects(['Archive', '2024_A']), ['2024_A', 'Archive']);
  });

  await t.test('undated projects sort alphabetically among themselves', () => {
    assert.deepEqual(sortProjects(['zebra', 'Archive', 'middle']), [
      'Archive',
      'middle',
      'zebra',
    ]);
  });

  await t.test('DEVIATION: the input array is left untouched', () => {
    // The legacy version sorts in place. No current caller observes that, but
    // relying on it would be a trap once these lists are reused.
    const input = ['2019_A', '2030_B'];
    const snapshot = [...input];
    sortProjects(input);
    assert.deepEqual(input, snapshot);
  });
});

test('partitionProjects matches the legacy inline logic', () => {
  for (const [cList, gList] of LISTS) {
    assert.deepEqual(
      partitionProjects([...cList], [...gList]),
      legacy.partitionProjects([...cList], [...gList]),
      `mismatch for c=${JSON.stringify(cList)} g=${JSON.stringify(gList)}`
    );
  }
});

test('partitionProjects: documented behaviour', async (t) => {
  const result = partitionProjects(
    ['2024_Shared', '2023_LocalOnly'],
    ['2024_Shared', '2022_SharedOnly']
  );

  await t.test('splits into synced / local-only / shared-only', () => {
    assert.deepEqual(result.common, ['2024_Shared']);
    assert.deepEqual(result.onlyC, ['2023_LocalOnly']);
    assert.deepEqual(result.onlyG, ['2022_SharedOnly']);
  });

  await t.test('common projects lead both columns so the tables line up', () => {
    // The middle sync-direction controls are positioned against C-drive rows by
    // index, so this ordering is what keeps the three columns aligned.
    assert.deepEqual(result.combinedC, ['2024_Shared', '2023_LocalOnly']);
    assert.deepEqual(result.combinedG, ['2024_Shared', '2022_SharedOnly']);
    assert.equal(result.combinedC[0], result.combinedG[0]);
  });
});
