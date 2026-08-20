'use strict';

const { state } = require('./state');
const { PAGE_SIZE, DEFAULT_VIEW } = require('../core/project-filter');

/**
 * The sort control and paging above the project tables, plus the at-risk warning.
 *
 * The filter chips (All / Synced / Local only / Shared only / Not syncing) were
 * removed from the UI. The filtering itself is still in core/project-filter and
 * still tested -- applyView just runs with the default "all" -- so bringing the
 * chips back is markup plus a click handler, not a rewrite.
 *
 * Changing sort or paging never touches the disk: client-search keeps the last
 * search in memory and re-renders from it, so these are instant.
 *
 * The chosen view lives in shared state rather than here, so client-search can
 * read it without importing this module. It imports client-search, and the reverse
 * import would close a cycle.
 */

/** Quote mode calls the same things quotes, not projects. */
function nounFor(mode) {
    return mode === 'quoteDirectory' ? 'quote' : 'project';
}

let onChange = () => {};

/**
 * Redraw the chips, counts and the at-risk warning for the current result.
 *
 * @param {{counts: object, atRisk: string[]}} view result from applyView
 * @param {string} mode current creationType
 */
function renderControls(view, mode) {
    const atRisk = document.getElementById('projectAtRisk');
    if (!atRisk) {
        return;
    }

    renderQueryNote(view, mode);
    renderPager(view, mode);

    // The at-risk warning is not a view, it is a standing risk: a project on the
    // local drive with no folder pair will never reach the shared drive on its
    // own. Kept now the filter chips are gone, but without its "Show" shortcut --
    // that switched to the Local only filter, which no longer has a control to
    // switch back with.
    const count = view.atRisk ? view.atRisk.length : 0;
    if (count === 0) {
        atRisk.style.display = 'none';
        atRisk.textContent = '';
        return;
    }

    const noun = nounFor(mode);
    atRisk.innerHTML =
        `<strong>${count} ${noun}${count === 1 ? '' : 's'}</strong> ` +
        `${count === 1 ? 'exists' : 'exist'} only on this PC and ${count === 1 ? 'is' : 'are'} ` +
        `not set up to sync.`;
    atRisk.style.display = 'block';
}

/**
 * "Showing 4 of 57 projects matching X", with a Clear button.
 *
 * The search box is several rows above the tables, so a narrowed list needs to
 * say so next to the list itself -- otherwise a client with 57 projects showing
 * 4 rows reads as a bug rather than a filter.
 */
function renderQueryNote(view, mode) {
    const note = document.getElementById('projectQueryNote');
    const text = document.getElementById('projectQueryText');

    if (!note || !text) {
        return;
    }

    if (!view.query) {
        note.style.display = 'none';
        note.classList.remove('no-match');
        text.textContent = '';
        return;
    }

    const noun = nounFor(mode);
    const none = view.total === 0;

    note.classList.toggle('no-match', none);
    text.textContent = none
        ? `No ${noun}s match “${view.query}”`
        : `Showing ${view.total} of ${view.totalUnfiltered} ${noun}s matching “${view.query}”`;
    note.style.display = 'flex';
}

/**
 * The paging footer.
 *
 * "Show more" adds a page each press. "Show all" only appears once the list has
 * been expanded at least once -- on a first look it is noise, but after a couple
 * of presses on a client with a few hundred projects it saves a lot of clicking.
 */
function renderPager(view, mode) {
    const pager = document.getElementById('projectPager');
    const more = document.getElementById('showMoreProjects');
    const all = document.getElementById('showAllProjects');
    const count = document.getElementById('projectPagerCount');

    if (!pager || !more || !all || !count) {
        return;
    }

    if (!view.hasMore) {
        // Nothing left to reveal. The count still shows when the list was paged,
        // so it is clear you are looking at everything.
        pager.style.display = view.total > PAGE_SIZE ? 'flex' : 'none';
        more.style.display = 'none';
        all.style.display = 'none';
        count.textContent = view.total > PAGE_SIZE ? `Showing all ${view.total}` : '';
        return;
    }

    const remaining = view.total - view.shown;
    const noun = nounFor(mode);

    pager.style.display = 'flex';
    more.style.display = 'inline-block';
    more.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;

    all.style.display = state.view.limit > PAGE_SIZE ? 'inline-block' : 'none';
    all.textContent = `Show all ${view.total}`;

    count.textContent = `Showing ${view.shown} of ${view.total} ${noun}s`;
}

/**
 * Back to the default list: everything, newest first, first page only.
 * Used by the Reset view button and whenever a different client is searched.
 */
function resetProjectView() {
    Object.assign(state.view, DEFAULT_VIEW);

    const sortSelect = document.getElementById('projectSortSelect');
    if (sortSelect) {
        sortSelect.value = state.view.sort;
    }
}

/**
 * Drop the search-box narrowing and empty the box itself.
 *
 * Reaches for the input by id rather than importing project-search, which owns
 * it. project-search imports client-search, which imports this module, so the
 * import would close a cycle -- and this is the same by-id reach project-search
 * already makes for the client box.
 */
function clearProjectQuery() {
    state.view.query = '';

    const input = document.getElementById('projectSearchInput');
    if (input) {
        input.value = '';
    }
}

/**
 * @param {{onChange: () => void}} deps re-render callback, injected to keep the
 *   module graph acyclic
 */
function initProjectFilters(deps = {}) {
    if (typeof deps.onChange === 'function') {
        onChange = deps.onChange;
    }

    const sortSelect = document.getElementById('projectSortSelect');

    if (sortSelect) {
        sortSelect.value = state.view.sort;
        sortSelect.addEventListener('change', () => {
            state.view.sort = sortSelect.value;
            // Re-sorting reorders the whole list, so the visible page would be a
            // different set of projects anyway. Start from the top.
            state.view.limit = PAGE_SIZE;
            onChange();
        });
    }

    const more = document.getElementById('showMoreProjects');
    if (more) {
        more.addEventListener('click', () => {
            state.view.limit += PAGE_SIZE;
            onChange();
        });
    }

    const all = document.getElementById('showAllProjects');
    if (all) {
        all.addEventListener('click', () => {
            state.view.limit = 0; // 0 means no cap
            onChange();
        });
    }

    const reset = document.getElementById('projectResetView');
    if (reset) {
        reset.addEventListener('click', () => {
            // "Default list" includes dropping the search text -- leaving the
            // tables narrowed after a reset would make the button look broken.
            clearProjectQuery();
            resetProjectView();
            onChange();
        });
    }

    const clearQuery = document.getElementById('projectQueryClear');
    if (clearQuery) {
        clearQuery.addEventListener('click', () => {
            clearProjectQuery();
            state.view.limit = PAGE_SIZE;
            onChange();
        });
    }

    // Switching between projects and quotes starts a new list, so the sort and
    // row count go back to default rather than carrying over.
    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        radio.addEventListener('change', resetProjectView);
    });
}

module.exports = { initProjectFilters, renderControls, resetProjectView };
