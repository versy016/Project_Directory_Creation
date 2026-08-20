'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const legacy = require('../legacy/legacy-implementations');
const {
  PROJECT_NAME_PATTERN,
  normaliseProjectName,
  isValidProjectName,
  extractYearFromProjectName,
} = require('../../src/core/project-name');

const RAW_NAMES = [
  '2024_Roadworks',
  '  2024_Road works  ',
  "2024_O'Brien",
  '2024_"Quoted"',
  '2024_Multi   Space',
  '2024_Tab\tSeparated',
  'E20240123_Bridge Survey',
  'C12345678_Bridge',
  '',
  '   ',
  'no year here',
];

const VALIDATION_CORPUS = [
  // valid
  '2024_Roadworks',
  '2010_A',
  '2050_A',
  '2024_Road works',
  '2024_Road/works',
  '2024_Road-works',
  'E20240123_Bridge',
  'C12345678_Bridge',
  // invalid
  '2009_TooOld',
  '2051_TooNew',
  '2024',
  '2024_',
  'Roadworks',
  'E2024_Bridge',
  'E202401234_Bridge',
  'C1234567_Bridge',
  'C123456789_Bridge',
  '_2024_Bridge',
  '2024-Bridge',
];

const YEAR_CORPUS = [
  '2024_Roadworks',
  'E20240123_Bridge',
  'C12345678_Bridge',
  'C20241234_Bridge',
  'Road_2019_old',
  'Project 2030 something',
  'NoYear',
  '1999_Old',
  '',
  '2024',
];

test('normaliseProjectName matches the legacy implementation', () => {
  for (const raw of RAW_NAMES) {
    assert.equal(
      normaliseProjectName(raw),
      legacy.normaliseProjectName(raw),
      `mismatch for ${JSON.stringify(raw)}`
    );
  }
});

test('normaliseProjectName: documented behaviour', async (t) => {
  await t.test('collapses any run of whitespace into a single underscore', () => {
    assert.equal(normaliseProjectName('2024_Multi   Space'), '2024_Multi_Space');
    assert.equal(normaliseProjectName('2024_Tab\tSeparated'), '2024_Tab_Separated');
  });

  await t.test('strips quotes, which would otherwise break the generated XML', () => {
    assert.equal(normaliseProjectName("2024_O'Brien"), '2024_OBrien');
    assert.equal(normaliseProjectName('2024_"Quoted"'), '2024_Quoted');
  });

  await t.test('trims before normalising, so padding never becomes an underscore', () => {
    assert.equal(normaliseProjectName('  2024_Road works  '), '2024_Road_works');
  });

  await t.test('DEVIATION: null/undefined yield "" instead of throwing', () => {
    // The legacy inline code calls .trim() on the raw DOM value, which is always
    // a string. Guarding here is defensive only -- no caller can reach it.
    assert.equal(normaliseProjectName(null), '');
    assert.equal(normaliseProjectName(undefined), '');
  });
});

test('isValidProjectName matches the legacy regex for every input', () => {
  for (const name of VALIDATION_CORPUS) {
    assert.equal(
      isValidProjectName(name),
      legacy.projectNamePattern.test(name.trim()),
      `mismatch for ${JSON.stringify(name)}`
    );
  }
});

test('the extracted pattern is character-identical to the legacy one', () => {
  assert.equal(PROJECT_NAME_PATTERN.source, legacy.projectNamePattern.source);
  assert.equal(PROJECT_NAME_PATTERN.flags, legacy.projectNamePattern.flags);
});

test('isValidProjectName: documented behaviour', async (t) => {
  await t.test('accepts the three documented shapes', () => {
    assert.ok(isValidProjectName('2024_Roadworks'));
    assert.ok(isValidProjectName('E20240123_Bridge'));
    assert.ok(isValidProjectName('C12345678_Bridge'));
  });

  await t.test('the year window is 2010-2050 inclusive', () => {
    assert.ok(isValidProjectName('2010_A'));
    assert.ok(isValidProjectName('2050_A'));
    assert.ok(!isValidProjectName('2009_A'));
    assert.ok(!isValidProjectName('2051_A'));
  });

  await t.test('a prefix with no descriptive suffix is rejected', () => {
    assert.ok(!isValidProjectName('2024'));
    assert.ok(!isValidProjectName('2024_'));
  });

  await t.test('the E prefix needs exactly year + 4 digits', () => {
    assert.ok(!isValidProjectName('E2024_Bridge'));
    assert.ok(!isValidProjectName('E202401234_Bridge'));
  });
});

test('extractYearFromProjectName matches the legacy implementation', () => {
  for (const name of YEAR_CORPUS) {
    assert.equal(
      extractYearFromProjectName(name),
      legacy.extractYearFromProjectName(name),
      `mismatch for ${JSON.stringify(name)}`
    );
  }
});

test('extractYearFromProjectName: documented behaviour', async (t) => {
  await t.test('reads a leading year prefix', () => {
    assert.equal(extractYearFromProjectName('2024_Roadworks'), 2024);
    assert.equal(extractYearFromProjectName('E20240123_Bridge'), 2024);
  });

  await t.test('QUIRK: unanchored, so it finds 20xx anywhere in the name', () => {
    // These drive the sort order of the project tables, so the quirk is visible
    // to users as "why is that project at the top".
    assert.equal(extractYearFromProjectName('Road_2019_old'), 2019);
    assert.equal(extractYearFromProjectName('Project 2030 something'), 2030);
    assert.equal(extractYearFromProjectName('C20241234_Bridge'), 2024);
  });

  await t.test('returns null when there is no 20xx to find', () => {
    assert.equal(extractYearFromProjectName('NoYear'), null);
    assert.equal(extractYearFromProjectName('1999_Old'), null);
    assert.equal(extractYearFromProjectName('C12345678_Bridge'), null);
  });
});
