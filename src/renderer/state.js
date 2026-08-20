'use strict';

/**
 * Shared mutable renderer state.
 *
 * WHY THIS IS AN OBJECT AND NOT THREE EXPORTED BINDINGS
 * ----------------------------------------------------
 * CommonJS copies primitives at destructure time. Had these been exported as
 * `let selectedDrive`, then:
 *
 *     const { selectedDrive } = require('./state');   // snapshots '' forever
 *
 * would capture the value at require time and silently never see an update --
 * the module would keep reading the empty-string default while the rest of the
 * app moved on. That failure loads cleanly, passes a smoke test, and only shows
 * up as projects being written to the wrong drive.
 *
 * So: always reach through the object. `state.selectedDrive`, never a destructure.
 *
 * These three were module-level `let`s in script.js. They are the only mutable
 * values shared across what are becoming separate renderer modules.
 */
const state = {
    /**
     * Resolved shared-drive root for the current client and drive toggle.
     * Either a G: bucket from getSharedDrivePath (note: forward slashes, quirk
     * #15) or the J: root. Starts empty -- see bug #12: anything that builds a
     * path before the first Search resolves against ''.
     */
    selectedDrive: '',

    /** 'G' or 'J'. Drives the button labels in the project tables. */
    driveSymbol: 'G',

    /**
     * UPPERCASED client names loaded from majorClients.json on the share.
     * Empty when that file is missing or unparseable -- see bug #26, a UTF-8 BOM
     * is enough to silently empty this list.
     */
    majorClients: [],

    /**
     * How the project tables are filtered and sorted.
     *
     * Lives here rather than in project-filters so client-search can read it when
     * rendering without importing that module -- client-search is imported BY the
     * filter bar, and the reverse import would close a cycle.
     */
    view: {
        filter: 'all',
        sort: 'yearDesc',
    },
};

module.exports = { state };
