'use strict';

const { DIFFERENCES_TWO_WAY, DIFFERENCES_ONE_WAY } = require('./ffs-config');
const { checkPair, STATUS } = require('./ffs-paths');

/**
 * Scanning and repairing FreeFileSync folder pairs. Pure: strings in, strings out.
 *
 * THE PROBLEM
 * -----------
 * This app writes each folder pair with a <Differences> element:
 *
 *     <Synchronize>
 *         <Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>
 *         ...
 *
 * If someone ticks "use database file to detect changes" in FreeFileSync, FFS
 * rewrites that pair into the two-way <Changes> form instead:
 *
 *     <Synchronize>
 *         <Changes>
 *             <Left Create="right" Update="right" Delete="none"/>
 *             <Right Create="none" Update="none" Delete="right"/>
 *         </Changes>
 *         ...
 *
 * The app's reader only understands <Differences>. It hits the first <Changes>
 * pair, throws, and the catch returns an empty list -- so EVERY pair in the file
 * disappears from the UI, not just the altered one. A single ticked checkbox makes
 * the app believe no project is synced.
 *
 * (The reader is now resilient to this too, but the files still want fixing: a
 * pair left in <Changes> form is syncing on different rules from the one the user
 * chose in this app.)
 *
 * WHAT COUNTS AS BROKEN
 * ---------------------
 * Only <Changes> INSIDE a <Pair>. The document also has a top-level <Synchronize>
 * holding the global defaults, and <Changes> is legitimate there -- the shipped
 * SyncSettings.ffs_gui has exactly that. Rewriting it would change the default for
 * every future pair, so pair blocks are located first and only their contents are
 * touched.
 */

const PAIR_BLOCK = /<Pair>[\s\S]*?<\/Pair>/g;
const CHANGES_BLOCK = /^([ \t]*)<Changes>[\s\S]*?<\/Changes>[ \t]*$/m;

const readTag = (block, tag) => {
    const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1] : null;
};

const readAttrs = (element) => {
    const attrs = {};
    for (const [, name, value] of element.matchAll(/(\w+)="([^"]*)"/g)) {
        attrs[name] = value;
    }
    return attrs;
};

/**
 * Decide which <Differences> form a <Changes> block corresponds to.
 *
 * The right-hand side is what distinguishes them: in a genuine two-way pair the
 * right side propagates content back (Create/Update point left), whereas a
 * one-way pair only pushes outward and leaves the right side inert.
 *
 * Delete is deliberately ignored. FreeFileSync sets it independently of the sync
 * direction, and treating a Delete rule as evidence of two-way sync would turn
 * one-way pairs into two-way ones -- which would start propagating changes back
 * to the local drive that the user never asked for.
 *
 * @returns {'two-way'|'one-way'}
 */
function classifyChanges(changesBlock) {
    const rightElement = changesBlock.match(/<Right\b[^/>]*\/?>/);
    const right = rightElement ? readAttrs(rightElement[0]) : {};

    const propagatesBack =
        (right.Create && right.Create !== 'none') || (right.Update && right.Update !== 'none');

    return propagatesBack ? 'two-way' : 'one-way';
}

/**
 * Report every pair in a config and whether it is in the broken form.
 *
 * @param {string} xml
 * @returns {{total: number, broken: Array<{left: string, right: string, becomes: string}>}}
 */
function analyseConfig(xml) {
    const blocks = String(xml || '').match(PAIR_BLOCK) || [];
    const broken = [];

    for (const block of blocks) {
        const changes = block.match(CHANGES_BLOCK);
        if (!changes) {
            continue;
        }

        broken.push({
            left: readTag(block, 'Left'),
            right: readTag(block, 'Right'),
            becomes: classifyChanges(changes[0]),
        });
    }

    return { total: blocks.length, broken };
}

/**
 * Rewrite every broken pair back into the form this app understands.
 *
 * Only the <Changes> element is replaced -- the surrounding indentation, the
 * DeletionPolicy, the VersioningFolder and every other pair are left exactly as
 * they were, so the diff a user reviews is limited to what actually changed.
 *
 * @param {string} xml
 * @returns {{xml: string, repairs: Array<{left: string, right: string, becomes: string}>}}
 */
function repairConfig(xml) {
    const repairs = [];

    const repaired = String(xml || '').replace(PAIR_BLOCK, (block) => {
        const changes = block.match(CHANGES_BLOCK);
        if (!changes) {
            return block;
        }

        const [wholeChanges, indent] = changes;
        const becomes = classifyChanges(wholeChanges);
        const replacement =
            indent + (becomes === 'two-way' ? DIFFERENCES_TWO_WAY : DIFFERENCES_ONE_WAY);

        repairs.push({
            left: readTag(block, 'Left'),
            right: readTag(block, 'Right'),
            becomes,
        });

        return block.replace(CHANGES_BLOCK, replacement);
    });

    return { xml: repaired, repairs };
}

/**
 * Repair the PATHS in every pair, leaving the sync settings alone.
 *
 * Runs alongside repairConfig: that one fixes the <Changes>/<Differences> shape,
 * this one fixes what Left and Right point at. See core/ffs-paths for what counts
 * as canonical and why mismatched pairs are reported rather than guessed at.
 *
 * @param {string} xml
 * @param {{mode?: string, jDrive?: boolean, majorClients?: string[]}} context
 * @returns {{xml: string, repairs: Array, problems: Array}}
 */
function repairPaths(xml, context = {}) {
    const repairs = [];
    const problems = [];

    const repaired = String(xml || '').replace(PAIR_BLOCK, (block) => {
        const left = readTag(block, 'Left');
        const right = readTag(block, 'Right');

        if (left === null || right === null) {
            return block;
        }

        const result = checkPair({ left, right }, context);

        if (result.status === STATUS.OK) {
            return block;
        }

        if (result.status !== STATUS.FIXED) {
            problems.push({
                left,
                right,
                client: result.client,
                project: result.project,
                reason: result.reason,
            });
            return block;
        }

        repairs.push({
            client: result.client,
            project: result.project,
            was: left,
            now: result.left,
            wasRight: right,
            nowRight: result.right,
            reason: result.reason,
        });

        return block
            .replace(/<Left>[\s\S]*?<\/Left>/, `<Left>${result.left}</Left>`)
            .replace(/<Right>[\s\S]*?<\/Right>/, `<Right>${result.right}</Right>`);
    });

    return { xml: repaired, repairs, problems };
}

module.exports = { analyseConfig, repairConfig, repairPaths, classifyChanges };
