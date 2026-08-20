'use strict';

const { state } = require('./state');
const { roots } = require('../config/roots');
const { QUOTE_DIRECTORY, CLIENT_PROJECT } = require('../core/paths');
const { filterProjectIndex, driveLabel } = require('../core/project-index');
const { listProjectsAcrossDrives } = require('../services/fs-repo');
const { getSharedDrivePath } = require('./major-clients');
const { searchForClient } = require('./client-search');

/**
 * Find a project by name, across both drives.
 *
 * The Client and Project boxes narrow together -- client "UPC" plus project
 * "2026" lists that client's 2026 jobs. Each row is tagged with where the project
 * actually lives: Both, C, or G/J.
 *
 * Rules:
 *   - suggestions appear once two characters have been typed
 *   - selecting an entry fills in the Client box and runs the normal search
 *   - clearing the Project box never clears the Client box
 *
 * The index is read from the drives, not from Algolia. The Tenders index lists
 * jobs that were quoted, which is a different set from the folders that exist,
 * and it keys on the client's name while every folder is named by ES Reference.
 * Reading the drives answers the question being asked, and the client box then
 * matches the folder name directly.
 */

const RESULT_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;

/**
 * Index cache, keyed by mode + shared drive.
 *
 * Measured on the real drives: ~10ms for the local walk and ~0.9s for the whole
 * shared side, because Google Drive caches directory metadata. Fine to build once
 * and hold; far too slow to redo on every keystroke.
 */
const cache = new Map();
const inFlight = new Map();

function currentMode() {
    return document.querySelector('input[name="creationType"]:checked').value;
}

function labelFor(mode) {
    return mode === QUOTE_DIRECTORY ? 'Quote' : 'Project';
}

/**
 * Which roots to walk, and whether the shared side is bucketed.
 *
 * Client projects on G: live under `_A`.._Z` buckets (plus major clients directly
 * under the base). Quotes, and the J drive, are flat client lists.
 */
function scanTargets(mode) {
    if (mode === QUOTE_DIRECTORY) {
        return {
            key: 'quotes',
            localRoot: roots.localAccounts,
            sharedRoot: roots.sharedQuotes,
            bucketed: false,
        };
    }

    const onJDrive = state.selectedDrive === roots.jDriveClients;

    return {
        key: onJDrive ? 'clients:J' : 'clients:G',
        localRoot: roots.localClients,
        // Deliberately the whole shared base rather than state.selectedDrive --
        // that holds one client's bucket, and this index spans every client.
        sharedRoot: onJDrive ? roots.jDriveClients : roots.sharedBase,
        bucketed: !onJDrive,
    };
}

async function getIndex(mode) {
    const target = scanTargets(mode);

    if (cache.has(target.key)) {
        return cache.get(target.key);
    }

    // Collapse concurrent builds: focus and input both fire before the first walk
    // finishes, and walking the shared drive twice would just be waste.
    if (!inFlight.has(target.key)) {
        const build = listProjectsAcrossDrives({
            localRoot: target.localRoot,
            sharedRoot: target.sharedRoot,
            bucketed: target.bucketed,
            majorClients: state.majorClients,
        })
            .then((entries) => {
                cache.set(target.key, entries);
                return entries;
            })
            .finally(() => {
                inFlight.delete(target.key);
            });

        inFlight.set(target.key, build);
    }

    return inFlight.get(target.key);
}

// Names come off the filesystem, so they are escaped before entering markup.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

function render(dropdown, entries, mode) {
    if (entries.length === 0) {
        dropdown.innerHTML = `<ul><li class="project-search-empty">No matching ${labelFor(
            mode
        ).toLowerCase()}s</li></ul>`;
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML =
        '<ul>' +
        entries
            .map((entry) => {
                const drive = driveLabel(entry, state.driveSymbol);
                const badge = drive === 'Both' ? 'both' : 'one';

                return (
                    `<li data-client="${escapeAttr(entry.client)}" ` +
                    `data-project="${escapeAttr(entry.project)}">` +
                    `<span class="project-search-name">${escapeHtml(entry.project)}</span>` +
                    `<span class="project-search-client">${escapeHtml(entry.client)}</span>` +
                    `<span class="project-search-drive ${badge}">${escapeHtml(drive)}</span></li>`
                );
            })
            .join('') +
        '</ul>';
    dropdown.style.display = 'block';
}

function initProjectSearch() {
    const input = document.getElementById('projectSearchInput');
    const dropdown = document.getElementById('projectSearchDropdown');
    const label = document.getElementById('projectSearchLabel');
    const clientInput = document.getElementById('clientInput');

    if (!input || !dropdown) {
        return;
    }

    function hide() {
        dropdown.innerHTML = '';
        dropdown.style.display = 'none';
    }

    let searchToken = 0;

    async function refresh() {
        const mode = currentMode();
        const projectText = input.value.trim();

        // Nothing is suggested until the Project box has enough to go on. Note
        // this hides the list rather than clearing anything -- the Client box is
        // never touched here.
        if (projectText.length < MIN_QUERY_LENGTH) {
            hide();
            return;
        }

        const token = ++searchToken;

        // The first build walks both drives, which takes about a second. Say so
        // rather than leaving the box looking broken.
        if (!cache.has(scanTargets(mode).key)) {
            dropdown.innerHTML =
                '<ul><li class="project-search-empty">Reading drives…</li></ul>';
            dropdown.style.display = 'block';
        }

        try {
            const entries = await getIndex(mode);
            if (token !== searchToken) {
                return;
            }

            render(
                dropdown,
                filterProjectIndex(entries, clientInput.value, projectText, {
                    limit: RESULT_LIMIT,
                }),
                mode
            );
        } catch (err) {
            console.error('Project search failed: ', err);
            if (token === searchToken) {
                dropdown.innerHTML =
                    '<ul><li class="project-search-empty">Search unavailable</li></ul>';
                dropdown.style.display = 'block';
            }
        }
    }

    input.addEventListener('focus', refresh);

    // Clearing the box hides the suggestions. It deliberately does NOT touch the
    // client field -- only an explicit selection below does that.
    input.addEventListener('input', refresh);

    // The client is half the filter, so retyping it re-narrows an open list.
    clientInput.addEventListener('input', () => {
        if (dropdown.style.display === 'block') {
            refresh();
        }
    });

    dropdown.addEventListener('click', (event) => {
        const item = event.target.closest('li[data-client]');
        if (!item) {
            return;
        }

        // The index is built from folder names, and folders are named by ES
        // Reference -- so this is already the value the client box wants. No
        // lookup needed, unlike when these suggestions came from Algolia.
        const clientReference = item.getAttribute('data-client');

        input.value = item.getAttribute('data-project');
        hide();

        clientInput.value = clientReference;
        state.selectedDrive = getSharedDrivePath(clientReference);
        searchForClient(clientReference, true);
    });

    document.addEventListener('click', (event) => {
        if (event.target !== input && !dropdown.contains(event.target)) {
            hide();
        }
    });

    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            const mode = currentMode();
            input.value = '';
            hide();
            if (label) {
                label.textContent = `${labelFor(mode)}:`;
            }
            input.placeholder = `Search for a ${labelFor(mode).toLowerCase()} by name...`;
        });
    });
}

/** Drop the cached index so the next search re-reads the drives. */
function invalidateProjectIndex() {
    cache.clear();
}

module.exports = { initProjectSearch, invalidateProjectIndex, CLIENT_PROJECT };
