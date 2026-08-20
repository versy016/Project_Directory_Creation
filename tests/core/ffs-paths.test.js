'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkPair, expectedPaths, STATUS } = require('../../src/core/ffs-paths');
const { QUOTE_DIRECTORY } = require('../../src/core/paths');

const MAJOR = ['UNITED PRECAST'];

/** The pair from the report -- a major client, so no letter bucket. */
const GOOD_LEFT = 'C:\\_Clients\\United Precast\\2026_UP1283_Regency_Rd_Broadview';
const GOOD_RIGHT = 'G:/Shared drives\\United Precast\\2026_UP1283_Regency_Rd_Broadview';

const ctx = { majorClients: MAJOR };

test('the canonical form is what the app itself writes', () => {
    const expected = expectedPaths({
        client: 'United Precast',
        project: '2026_UP1283_Regency_Rd_Broadview',
        majorClients: MAJOR,
    });

    assert.equal(expected.local, GOOD_LEFT);
    assert.equal(expected.shared, GOOD_RIGHT);
});

test('a correct pair is left alone', () => {
    assert.equal(checkPair({ left: GOOD_LEFT, right: GOOD_RIGHT }, ctx).status, STATUS.OK);
});

test('mixed separators on the shared side are correct, not a fault', () => {
    // getSharedDrivePath emits forward slashes and the join adds a backslash.
    // "Fixing" this would rewrite every healthy pair in every config.
    const result = checkPair({ left: GOOD_LEFT, right: GOOD_RIGHT }, ctx);
    assert.equal(result.status, STATUS.OK);
    assert.ok(GOOD_RIGHT.includes('/') && GOOD_RIGHT.includes('\\'));
});

test('a major client wrongly placed in a letter bucket is corrected', () => {
    const result = checkPair(
        {
            left: GOOD_LEFT,
            right: 'G:/Shared drives/_U\\United Precast\\2026_UP1283_Regency_Rd_Broadview',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.right, GOOD_RIGHT);
});

test('an ordinary client wrongly placed at the base is bucketed', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_Mary_Mackillop',
            right: 'G:/Shared drives\\Sarah Build\\2023_Mary_Mackillop',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.right, 'G:/Shared drives/_S\\Sarah Build\\2023_Mary_Mackillop');
});

test('the wrong letter bucket is corrected', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_Mary_Mackillop',
            right: 'G:/Shared drives/_B\\Sarah Build\\2023_Mary_Mackillop',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.match(result.right, /_S\\Sarah Build/);
});

test('the sync direction is preserved when a pair is rebuilt', () => {
    // A "G to C" pair has the shared side on the LEFT. Rebuilding must not
    // silently reverse it -- that would flip which drive wins.
    const result = checkPair(
        {
            left: 'G:/Shared drives/_B\\Sarah Build\\2023_X',
            right: 'C:\\_Clients\\Sarah Build\\2023_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.match(result.left, /^G:/, 'the shared side must stay on the left');
    assert.match(result.right, /^C:/);
});

test('a double-escaped ampersand is collapsed to one', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_Aldinga_Hockey_&amp;amp;_Soccer',
            right: 'G:/Shared drives/_S\\Sarah Build\\2023_Aldinga_Hockey_&amp;amp;_Soccer',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.left, 'C:\\_Clients\\Sarah Build\\2023_Aldinga_Hockey_&amp;_Soccer');
    assert.match(result.reason, /double-escaped/);
});

test('a correctly escaped ampersand is left alone', () => {
    const left = 'C:\\_Clients\\Sarah Build\\2023_Aldinga_Hockey_&amp;_Soccer';
    const right = 'G:/Shared drives/_S\\Sarah Build\\2023_Aldinga_Hockey_&amp;_Soccer';

    assert.equal(checkPair({ left, right }, ctx).status, STATUS.OK);
});

test('trailing separators and stray whitespace are trimmed', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_X\\ ',
            right: 'G:/Shared drives/_S\\Sarah Build\\2023_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.left, 'C:\\_Clients\\Sarah Build\\2023_X');
});

test('doubled separators are normalised', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\\\Sarah Build\\2023_X',
            right: 'G:/Shared drives/_S\\Sarah Build\\2023_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.left, 'C:\\_Clients\\Sarah Build\\2023_X');
});

/**
 * The dangerous case. Guessing which side is wrong could aim a live sync at
 * someone else's folder, so it is reported and left untouched.
 */
test('a pair naming two different projects is reported, never guessed at', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\ACME\\2024_Roadworks',
            right: 'G:/Shared drives/_A\\ACME\\2024_Bridge',
        },
        ctx
    );

    assert.equal(result.status, STATUS.MISMATCH);
    assert.match(result.reason, /different folders/);
    assert.equal(result.left, undefined, 'no replacement should be offered');
});

test('a pair naming two different clients is reported too', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\ACME\\2024_X',
            right: 'G:/Shared drives/_B\\BETA\\2024_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.MISMATCH);
});

test('a pair with no local side is reported, not rebuilt', () => {
    const result = checkPair(
        {
            left: 'D:\\Somewhere\\ACME\\2024_X',
            right: 'G:/Shared drives/_A\\ACME\\2024_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.UNKNOWN_ROOT);
    assert.match(result.reason, /neither side/);
});

test('a pair with two local sides is reported', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\ACME\\2024_X',
            right: 'C:\\_Clients\\ACME\\2024_Y',
        },
        ctx
    );

    assert.equal(result.status, STATUS.UNKNOWN_ROOT);
    assert.match(result.reason, /both sides/);
});

test('J drive pairs are flat, with no letter bucket', () => {
    const expected = expectedPaths({
        client: 'Sarah Build',
        project: '2023_X',
        jDrive: true,
        majorClients: MAJOR,
    });

    assert.equal(expected.shared, 'J:\\__Clients\\Sarah Build\\2023_X');

    // A J config that had a G bucket path stitched into it gets corrected.
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_X',
            right: 'G:/Shared drives/_S\\Sarah Build\\2023_X',
        },
        { majorClients: MAJOR, jDrive: true }
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.equal(result.right, 'J:\\__Clients\\Sarah Build\\2023_X');
});

test('a correct J drive pair is left alone', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_X',
            right: 'J:\\__Clients\\Sarah Build\\2023_X',
        },
        { majorClients: MAJOR, jDrive: true }
    );

    assert.equal(result.status, STATUS.OK);
});

test('quote pairs use the accounts roots, with no bucketing', () => {
    const expected = expectedPaths({
        client: 'ACME',
        project: '2024_Quote',
        mode: QUOTE_DIRECTORY,
        majorClients: MAJOR,
    });

    assert.equal(expected.local, 'C:\\__Accounts\\__Clients\\ACME\\2024_Quote');
    assert.equal(
        expected.shared,
        'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\ACME\\2024_Quote'
    );

    const result = checkPair(
        { left: expected.local, right: expected.shared },
        { mode: QUOTE_DIRECTORY, majorClients: MAJOR }
    );
    assert.equal(result.status, STATUS.OK);
});

test('a quote pair pointing at the client-projects root is corrected', () => {
    const result = checkPair(
        {
            left: 'C:\\__Accounts\\__Clients\\ACME\\2024_Quote',
            right: 'G:/Shared drives/_A\\ACME\\2024_Quote',
        },
        { mode: QUOTE_DIRECTORY, majorClients: MAJOR }
    );

    assert.equal(result.status, STATUS.FIXED);
    assert.match(result.right, /Accounts QT/);
});

test('major-client matching is case-insensitive', () => {
    const result = checkPair(
        {
            left: 'C:\\_Clients\\united precast\\2026_X',
            right: 'G:/Shared drives\\united precast\\2026_X',
        },
        ctx
    );

    assert.equal(result.status, STATUS.OK, 'lower-case should still count as major');
});

test('repairing is idempotent', () => {
    const first = checkPair(
        {
            left: 'C:\\_Clients\\Sarah Build\\2023_X',
            right: 'G:/Shared drives\\Sarah Build\\2023_X',
        },
        ctx
    );
    assert.equal(first.status, STATUS.FIXED);

    const second = checkPair({ left: first.left, right: first.right }, ctx);
    assert.equal(second.status, STATUS.OK);
});
