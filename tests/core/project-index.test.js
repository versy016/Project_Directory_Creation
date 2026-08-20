'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    filterProjectIndex,
    driveLabel,
    tokenise,
} = require('../../src/core/project-index');

const entry = (client, project, onLocal, onShared) => ({ client, project, onLocal, onShared });

const INDEX = [
    entry('UPC', '2026_ServiceStation', true, true),
    entry('UPC', '2026_NicholsonAve', true, false),
    entry('UPC', '2026_SurveyRates', false, true),
    entry('UPC', '2018_OldDepot', true, true),
    entry('Bottlebrush', '2026_Rates', true, true),
    entry('ROADSTAR', '2022_Culvert', true, false),
    entry('ACME', 'Archive', true, false),
];

const names = (hits) => hits.map((h) => `${h.client}/${h.project}`);

test('the drive label reflects where the project actually is', () => {
    assert.equal(driveLabel({ onLocal: true, onShared: true }), 'Both');
    assert.equal(driveLabel({ onLocal: true, onShared: false }), 'C');
    assert.equal(driveLabel({ onLocal: false, onShared: true }), 'G');
});

test('the shared label follows the drive toggle', () => {
    assert.equal(driveLabel({ onLocal: false, onShared: true }, 'J'), 'J');
    assert.equal(driveLabel({ onLocal: true, onShared: true }, 'J'), 'Both');
});

test('the client and project boxes narrow together', () => {
    // The scenario as specified: a client plus a year.
    const hits = filterProjectIndex(INDEX, 'UPC', '2026');

    assert.deepEqual(names(hits).sort(), [
        'UPC/2026_NicholsonAve',
        'UPC/2026_ServiceStation',
        'UPC/2026_SurveyRates',
    ]);
});

test('the client filter excludes another client\'s matching project', () => {
    const hits = filterProjectIndex(INDEX, 'UPC', '2026');
    assert.ok(!names(hits).includes('Bottlebrush/2026_Rates'));
});

test('the client filter excludes that client\'s other years', () => {
    const hits = filterProjectIndex(INDEX, 'UPC', '2026');
    assert.ok(!names(hits).includes('UPC/2018_OldDepot'));
});

test('the client alone lists everything that client has', () => {
    assert.equal(filterProjectIndex(INDEX, 'UPC', '').length, 4);
});

test('the project alone searches across clients', () => {
    const hits = filterProjectIndex(INDEX, '', '2026');
    assert.equal(hits.length, 4, names(hits).join(', '));
});

test('typing more narrows further', () => {
    const one = filterProjectIndex(INDEX, '', '2026').length;
    const two = filterProjectIndex(INDEX, '', '2026 nicholson').length;

    assert.ok(two < one, `${one} -> ${two}`);
    assert.deepEqual(names(filterProjectIndex(INDEX, '', '2026 nicholson')), [
        'UPC/2026_NicholsonAve',
    ]);
});

test('matching is case-insensitive and order-independent', () => {
    assert.deepEqual(
        names(filterProjectIndex(INDEX, 'upc', 'NICHOLSON 2026')),
        ['UPC/2026_NicholsonAve']
    );
});

test('the client box matches the client folder only, never a project name', () => {
    // "Archive" is a project of ACME. Typing it as a CLIENT must find nothing,
    // otherwise the two boxes would not be independent filters.
    assert.deepEqual(filterProjectIndex(INDEX, 'Archive', ''), []);
});

test('a project can still be found by its client name via the project box', () => {
    const hits = filterProjectIndex(INDEX, '', 'bottlebrush');
    assert.deepEqual(names(hits), ['Bottlebrush/2026_Rates']);
});

test('project-name matches outrank client-name matches', () => {
    // ROADSTAR is a client; the Rates projects are projects. Someone typing
    // "rates" wants the projects first.
    const hits = names(filterProjectIndex(INDEX, '', 'rates'));
    assert.ok(hits[0].endsWith('_Rates') || hits[0].endsWith('_SurveyRates'), hits.join(', '));
});

test('results are newest first, undated last', () => {
    const hits = names(filterProjectIndex(INDEX, '', ''));
    assert.equal(hits[hits.length - 1], 'ACME/Archive');
});

test('a query that matches nothing returns nothing', () => {
    assert.deepEqual(filterProjectIndex(INDEX, '', 'nonexistent'), []);
    assert.deepEqual(filterProjectIndex(INDEX, 'nonexistent', ''), []);
});

test('the limit caps the list', () => {
    assert.equal(filterProjectIndex(INDEX, '', '', { limit: 2 }).length, 2);
    assert.equal(filterProjectIndex(INDEX, '', '', { limit: 0 }).length, INDEX.length);
});

test('an empty index is handled', () => {
    assert.deepEqual(filterProjectIndex([], 'UPC', '2026'), []);
    assert.deepEqual(filterProjectIndex(undefined, '', ''), []);
});

test('tokenise ignores surrounding and repeated whitespace', () => {
    assert.deepEqual(tokenise('  2026   road '), ['2026', 'road']);
    assert.deepEqual(tokenise(''), []);
    assert.deepEqual(tokenise(null), []);
});
