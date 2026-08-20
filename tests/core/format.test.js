'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const legacy = require('../legacy/legacy-implementations');
const { formatBytes, formatDateLabel } = require('../../src/core/format');

const BYTE_CORPUS = [
  0, 1, 512, 1023, 1024, 1025, 1536, 1048576, 1073741824, 2684354560, 1099511627776,
  1234567890123,
];

const DECIMALS = [0, 1, 2, 3, -1];

test('formatBytes matches the legacy implementation', () => {
  for (const bytes of BYTE_CORPUS) {
    for (const decimals of DECIMALS) {
      assert.equal(
        formatBytes(bytes, decimals),
        legacy.formatBytes(bytes, decimals),
        `mismatch for ${bytes} @ ${decimals}dp`
      );
    }
    assert.equal(formatBytes(bytes), legacy.formatBytes(bytes));
  }
});

test('formatBytes: documented behaviour', async (t) => {
  await t.test('picks the right unit and rounds to 2dp by default', () => {
    assert.equal(formatBytes(0), '0 Bytes');
    assert.equal(formatBytes(1023), '1023 Bytes');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(1073741824), '1 GB');
    assert.equal(formatBytes(2684354560), '2.5 GB');
  });

  await t.test('a negative decimal count is clamped to 0', () => {
    assert.equal(formatBytes(1536, -1), '2 KB');
  });
});

test('formatDateLabel matches the legacy implementation', () => {
  const dates = [
    new Date(2026, 0, 1),
    new Date(2026, 7, 18),
    new Date(2026, 11, 31),
    new Date(2024, 1, 29),
    new Date(2010, 9, 5),
  ];

  for (const date of dates) {
    assert.equal(formatDateLabel(date), legacy.formatDateLabel(date));
  }
});

test('formatDateLabel: documented behaviour', async (t) => {
  await t.test('pads to YYYY_MM_DD, which is the on-disk folder name', () => {
    assert.equal(formatDateLabel(new Date(2026, 0, 1)), '2026_01_01');
    assert.equal(formatDateLabel(new Date(2026, 7, 18)), '2026_08_18');
    assert.equal(formatDateLabel(new Date(2026, 11, 31)), '2026_12_31');
  });

  await t.test('uses local time, matching what the user sees in the date picker', () => {
    const date = new Date(2026, 7, 18, 23, 59, 59);
    assert.equal(formatDateLabel(date), '2026_08_18');
  });
});
