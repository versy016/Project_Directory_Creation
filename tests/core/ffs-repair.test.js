'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyseConfig, repairConfig, classifyChanges } = require('../../src/core/ffs-repair');
const ffs = require('../../src/core/ffs-config');

/** A healthy one-way pair, exactly as this app writes it. */
const GOOD_PAIR = `        <Pair>
            <Left>C:\\_Clients\\Sarah Build\\2023_Mary_Mackillop</Left>
            <Right>G:/Shared drives/_S\\Sarah Build\\2023_Mary_Mackillop</Right>
            <Synchronize>
                <Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`;

/** A healthy two-way pair. */
const GOOD_TWO_WAY = `        <Pair>
            <Left>C:\\_Clients\\Sarah Build\\2023_Aldinga_Hockey_&amp;_Soccer</Left>
            <Right>G:/Shared drives/_S\\Sarah Build\\2023_Aldinga_Hockey_&amp;_Soccer</Right>
            <Synchronize>
                <Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`;

/** Verbatim from a real config after "use database file to detect changes". */
const BROKEN_ONE_WAY = `        <Pair>
            <Left>C:\\_Clients\\Sarah Build\\E20210092_Sarah Build PAC</Left>
            <Right>G:/Shared drives/_S\\Sarah Build\\E20210092_Sarah Build PAC</Right>
            <Synchronize>
                <Changes>
                    <Left Create="right" Update="right" Delete="none"/>
                    <Right Create="none" Update="none" Delete="right"/>
                </Changes>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`;

/** A genuinely two-way pair in the database form: the right side pushes back. */
const BROKEN_TWO_WAY = `        <Pair>
            <Left>C:\\_Clients\\ACME\\2024_Both</Left>
            <Right>G:/Shared drives/_A\\ACME\\2024_Both</Right>
            <Synchronize>
                <Changes>
                    <Left Create="right" Update="right" Delete="right"/>
                    <Right Create="left" Update="left" Delete="left"/>
                </Changes>
                <DeletionPolicy>RecycleBin</DeletionPolicy>
                <VersioningFolder Style="Replace"/>
            </Synchronize>
        </Pair>`;

const wrap = (...pairs) =>
    ffs.createFullXmlConfig('').replace('    </FolderPairs>', `${pairs.join('\n')}\n    </FolderPairs>`);

test('analyseConfig counts pairs and flags only the broken ones', () => {
    const report = analyseConfig(wrap(GOOD_PAIR, BROKEN_ONE_WAY, GOOD_TWO_WAY));

    assert.equal(report.total, 3);
    assert.equal(report.broken.length, 1);
    assert.match(report.broken[0].left, /E20210092_Sarah Build PAC/);
});

test('a healthy config reports nothing to fix', () => {
    const report = analyseConfig(wrap(GOOD_PAIR, GOOD_TWO_WAY));
    assert.deepEqual(report.broken, []);
});

/**
 * The shipped template's TOP-LEVEL <Synchronize> legitimately uses <Changes> --
 * those are the global defaults for new pairs. Rewriting it would silently change
 * the default sync behaviour for everything created afterwards.
 */
test('the global <Changes> defaults outside any pair are left alone', () => {
    const shipped = fs.readFileSync(
        path.join(__dirname, '..', '..', 'SyncSettings.ffs_gui'),
        'utf-8'
    );

    assert.ok(shipped.includes('<Changes>'), 'precondition: the template has global Changes');
    assert.deepEqual(analyseConfig(shipped).broken, [], 'global defaults must not be flagged');

    const { xml, repairs } = repairConfig(shipped);
    assert.deepEqual(repairs, []);
    assert.equal(xml, shipped, 'a config with no broken pairs must come back untouched');
});

/** <Changes> remaining anywhere inside a <Pair> means the repair missed one. */
const changesInsidePairs = (xml) =>
    (xml.match(/<Pair>[\s\S]*?<\/Pair>/g) || []).filter((block) => block.includes('<Changes>'));

test('repairConfig converts a broken pair back to <Differences>', () => {
    const { xml, repairs } = repairConfig(wrap(BROKEN_ONE_WAY));

    assert.equal(repairs.length, 1);
    // Deliberately scoped to pairs: the document's global <Synchronize> keeps its
    // own <Changes> defaults, and a bare includes() would wrongly fail on those.
    assert.deepEqual(changesInsidePairs(xml), [], 'no pair should still hold a Changes block');
    assert.ok(xml.includes(ffs.DIFFERENCES_ONE_WAY));
    assert.ok(xml.includes('<Changes>'), 'the global defaults are still there');
});

test('a right side that pushes content back is restored as two-way', () => {
    const { xml, repairs } = repairConfig(wrap(BROKEN_TWO_WAY));

    assert.equal(repairs[0].becomes, 'two-way');
    assert.ok(xml.includes(ffs.DIFFERENCES_TWO_WAY));
});

test('Delete rules alone never promote a pair to two-way', () => {
    // The real broken example has Right Delete="right" but no Create/Update.
    // Treating that as two-way would start pushing changes back onto the local
    // drive that the user never asked for.
    assert.equal(
        classifyChanges(`<Changes>
            <Left Create="right" Update="right" Delete="none"/>
            <Right Create="none" Update="none" Delete="right"/>
        </Changes>`),
        'one-way'
    );
});

test('only the broken pair is rewritten; healthy pairs are untouched', () => {
    const before = wrap(GOOD_PAIR, BROKEN_ONE_WAY, GOOD_TWO_WAY);
    const { xml } = repairConfig(before);

    assert.ok(xml.includes(GOOD_PAIR), 'the healthy one-way pair should be byte-identical');
    assert.ok(xml.includes(GOOD_TWO_WAY), 'the healthy two-way pair should be byte-identical');
});

test('indentation and the rest of the pair survive the rewrite', () => {
    const { xml } = repairConfig(wrap(BROKEN_ONE_WAY));

    assert.ok(
        xml.includes(`                ${ffs.DIFFERENCES_ONE_WAY}`),
        'the replacement should sit at the same indent the <Changes> block had'
    );
    assert.ok(xml.includes('<DeletionPolicy>RecycleBin</DeletionPolicy>'));
    assert.ok(xml.includes('<VersioningFolder Style="Replace"/>'));
    assert.ok(xml.includes('E20210092_Sarah Build PAC'), 'paths must be preserved');
});

test('escaped characters in paths are preserved exactly', () => {
    const { xml } = repairConfig(wrap(BROKEN_ONE_WAY, GOOD_TWO_WAY));
    assert.ok(xml.includes('2023_Aldinga_Hockey_&amp;_Soccer'), 'the &amp; entity must survive');
});

test('repairing is idempotent', () => {
    const once = repairConfig(wrap(BROKEN_ONE_WAY)).xml;
    const twice = repairConfig(once);

    assert.deepEqual(twice.repairs, [], 'a repaired config has nothing left to repair');
    assert.equal(twice.xml, once);
});

/** The whole point: after repair, the app can read the file again. */
test('a repaired config parses, and every pair reappears', async () => {
    const before = wrap(GOOD_PAIR, BROKEN_ONE_WAY, GOOD_TWO_WAY);

    const beforePairs = await ffs.parseFolderPairs(before);
    const { xml } = repairConfig(before);
    const afterPairs = await ffs.parseFolderPairs(xml);

    assert.equal(afterPairs.length, 3, 'all three pairs should be visible after repair');
    assert.ok(
        afterPairs.length > beforePairs.length,
        `repair should recover pairs (${beforePairs.length} -> ${afterPairs.length})`
    );
});

test('an empty or pairless config is handled', () => {
    assert.deepEqual(analyseConfig('').broken, []);
    assert.deepEqual(repairConfig('').repairs, []);
    assert.deepEqual(analyseConfig(null).broken, []);
    assert.deepEqual(repairConfig(ffs.createFullXmlConfig('')).repairs, []);
});
