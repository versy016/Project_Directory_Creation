'use strict';

const path = require('path');
const { ipcRenderer } = require('electron');

const { state } = require('./state');
const { roots } = require('../config/roots');
const { forType } = require('../core/paths');
const { partitionProjects } = require('../core/sorting');
const { applyView, pairedProjectNames } = require('../core/project-filter');
const { renderControls, resetProjectView } = require('./project-filters');
const { formatBytes } = require('../core/format');
const ffsConfig = require('../core/ffs-config');
const {
    readProjectsFromDirectory,
    readSubfolders,
    getFolderSize,
    readExistingXmlConfig,
    pathExists,
} = require('../services/fs-repo');
const { searchIndices } = require('../services/algolia');
const { getSharedDrivePath } = require('./major-clients');
const { populateProjects } = require('./project-tables');
const { populateDirectionColumn } = require('./sync-controls');

/**
 * Finding a client and rendering what they have on each drive.
 *
 * This module owns `searchForClient`, which is the app's central refresh: almost
 * every action that changes the filesystem calls it afterwards to redraw. Other
 * modules receive it by injection rather than importing it, so the dependency
 * graph stays acyclic -- see initProjectTables in app wiring.
 */

/** The [local, shared] roots for whichever mode is selected. */
function getBaseDirectories() {
    const selectedValue = document.querySelector('input[name="creationType"]:checked').value;

    if (selectedValue !== 'clientProject' && selectedValue !== 'quoteDirectory') {
        return []; // Default empty array to prevent crashes
    }

    const { localRoot, sharedRoot } = forType(selectedValue, {
        selectedDrive: state.selectedDrive,
    });
    return [localRoot, sharedRoot];
}

/**
 * Read a .ffs_gui off disk and hand it to core/ffs-config for parsing.
 */
async function readAndProcessXmlConfig(filePath) {
    return ffsConfig.parseFolderPairs(await readExistingXmlConfig(filePath));
}

/**
 * Search both drives for a client and redraw the two tables plus the sync column.
 *
 * @param {string} clientName
 * @param {boolean} refresh retained for call-site compatibility; unused since the
 *   copy-prompt modals it gated were removed as unreachable.
 */
/**
 * The last search, kept so the filter and sort controls can re-render without
 * touching the disk again. Re-reading two drives on every chip click would make
 * the controls feel sluggish for no reason -- filtering is a view over data we
 * already have.
 */
let lastResult = null;

/**
 * Re-render the tables from the last search using the current filter and sort.
 * Safe to call before any search has run.
 */
function renderProjectView() {
    if (!lastResult) {
        return;
    }

    const { partition, configData, cpath, gpath, mode } = lastResult;

    const view = applyView(partition, {
        filter: state.view.filter,
        sort: state.view.sort,
        limit: state.view.limit,
        paired: pairedProjectNames(configData),
    });

    renderControls(view, mode);

    // Await both tables before drawing the middle column: it is positioned
    // against the rendered C-drive rows, so it has to run last.
    return Promise.resolve()
        .then(() => populateProjects(view.c, 'cDriveProjects', cpath))
        .then(() => populateProjects(view.g, 'gDriveProjects', gpath))
        .then(() => populateDirectionColumn(view.common, configData));
}

async function searchForClient(clientName, refresh) {
    // REMOVED: this used to attach a 'change' listener to every creationType radio
    // on each call, reassigning a local that had already been read synchronously
    // below. The listeners accumulated on every search and could not affect
    // anything -- same class of leak as bug #10.
    const baseDirectories = getBaseDirectories();

    const directoryPaths = baseDirectories.map((dir) => path.join(dir, clientName));

    const searchResults = await Promise.all(
        directoryPaths.map(async (clientPath) => {
            try {
                return await readProjectsFromDirectory(clientPath);
            } catch (err) {
                // A client with no folder on one drive is normal, not an error.
                console.error(`Error reading directory ${clientPath}: `, err);
                return [];
            }
        })
    );

    const partition = partitionProjects(searchResults[0], searchResults[1]);

    // A different client is a different list, so the view goes back to default.
    // Re-searching the SAME client keeps it -- creating a project re-runs this,
    // and having your filter and paging reset underneath you would be annoying.
    if (!lastResult || lastResult.clientName !== clientName) {
        resetProjectView();
    }

    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    const modePaths = forType(selectedCreationType, { selectedDrive: state.selectedDrive });

    // Cached so the filter and sort controls can redraw without re-reading disk.
    lastResult = {
        clientName,
        partition,
        configData: await readAndProcessXmlConfig(modePaths.ffsConfigPath),
        cpath: path.join(modePaths.localRoot, clientName),
        gpath: path.join(modePaths.sharedRoot, clientName),
        mode: selectedCreationType,
    };

    await renderProjectView();
}

/**
 * The G/J toggle. Switching drives re-points shared state and re-runs the search.
 */
function initDriveToggle() {
    document.getElementById('driveToggle').addEventListener('change', function () {
        const clientName = document.getElementById('clientInput').value.trim();

        if (this.checked) {
            document.getElementById('switchid').textContent = 'Switch to Sync C & G';
            document.getElementById('gDriveHeading').textContent = 'J Drive Projects:';
            document.querySelector('.quotediv').style.display = 'none';

            state.selectedDrive = roots.jDriveClients;
            state.driveSymbol = 'J';
        } else {
            document.getElementById('switchid').textContent = 'Switch to Sync C & J';
            document.getElementById('gDriveHeading').textContent = 'G Drive Projects:';
            document.querySelector('.quotediv').style.display = 'inline';

            state.selectedDrive = getSharedDrivePath(clientName);
            state.driveSymbol = 'G';
        }

        if (clientName !== '') {
            searchForClient(clientName, true);
        }
    });

    // The J toggle is meaningless for quotes, so hide it in that mode.
    function updateToggleVisibility() {
        const quoteDirectoryRadio = document.querySelector(
            'input[name="creationType"][value="quoteDirectory"]'
        );
        document.getElementById('driveContainter').style.display = quoteDirectoryRadio.checked
            ? 'none'
            : 'block';
    }

    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        radio.addEventListener('change', updateToggleVisibility);
    });
    updateToggleVisibility();
}

/**
 * The Search button in the "Create New Project" modal: lists each of the client's
 * projects with its size on disk. Independent of the main table search.
 */
function initClientFolderSizeSearch() {
    document.getElementById('searchclientButton').addEventListener('click', async () => {
        const clientName = document.getElementById('clientInput1').value.trim();
        if (clientName === '') {
            ipcRenderer.send('show-custom-alert', 'Please enter a client name.');
            return;
        }

        const selectedCreationType = document.querySelector(
            'input[name="creationType"]:checked'
        ).value;
        const modePaths = forType(selectedCreationType, { selectedDrive: state.selectedDrive });

        const containers = [
            {
                folder: path.join(modePaths.localRoot, clientName),
                container: document.getElementById('subfoldersContainerC'),
                heading: document.getElementById('subfoldersHeadingC'),
            },
            {
                folder: path.join(modePaths.sharedRoot, clientName),
                container: document.getElementById('subfoldersContainerG'),
                heading: document.getElementById('subfoldersHeadingG'),
            },
        ];

        for (const { container, heading } of containers) {
            container.innerHTML = '';
            heading.style.display = 'none';
        }

        try {
            for (const { folder, container, heading } of containers) {
                heading.style.display = 'block';

                if (!(await pathExists(folder))) {
                    container.textContent = 'Client not found.';
                    continue;
                }

                const subfolders = await readSubfolders(folder);
                if (subfolders.length === 0) {
                    container.textContent = 'No projects exist.';
                    continue;
                }

                for (const subfolder of subfolders) {
                    const folderSize = await getFolderSize(path.join(folder, subfolder));
                    const li = document.createElement('li');
                    li.textContent = `${subfolder} - ${formatBytes(folderSize)}`;
                    container.appendChild(li);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });
}

/** Client-reference autocomplete backed by the Algolia clients index. */
function initClientAutocomplete() {
    const clientInput = document.getElementById('clientInput');
    const clientDropdown = document.getElementById('clientDropdown');

    clientInput.addEventListener('input', function () {
        const query = this.value;

        if (query.length < 2) {
            clientDropdown.innerHTML = '';
            return;
        }

        searchIndices.clients
            .search(query, { hitsPerPage: 30 })
            .then(({ hits }) => {
                clientDropdown.innerHTML =
                    '<ul>' + hits.map((hit) => `<li>${hit.reference}</li>`).join('') + '</ul>';
            })
            .catch((err) => {
                console.error('Algolia search error: ', err);
            });
    });

    clientDropdown.addEventListener('click', function (e) {
        if (e.target.tagName === 'LI') {
            clientInput.value = e.target.textContent;
            clientDropdown.innerHTML = '';
        }
    });
}

/**
 * Switching mode re-lists whatever is directly under the two roots.
 *
 * Note these calls pass a bare drive root rather than a client folder, which
 * populateProjects deliberately bails out on -- so in practice this clears the
 * tables rather than filling them. Preserved as-is.
 */
function initCreationTypeListing() {
    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        radio.addEventListener('change', async (event) => {
            const isClientProject = event.target.value === 'clientProject';
            document.getElementById('projecttypes').style.display = isClientProject
                ? 'block'
                : 'none';

            const localRoot = isClientProject ? roots.localClients : roots.localAccounts;
            const sharedRoot = isClientProject ? state.selectedDrive : roots.sharedQuotes;

            try {
                const cDriveProjects = await readProjectsFromDirectory(localRoot);
                const gDriveProjects = await readProjectsFromDirectory(sharedRoot);
                populateProjects(cDriveProjects, 'cDriveProjects', localRoot);
                populateProjects(gDriveProjects, 'gDriveProjects', sharedRoot);
            } catch (err) {
                console.error('Error reading directories: ', err);
            }
        });
    });
}

function initClientSearch() {
    // Two separate handlers on the same button, both original: the first resolves
    // the shared-drive root for the typed client, the second runs the search.
    // Order matters -- the search reads state.selectedDrive.
    document.getElementById('searchButton').addEventListener('click', () => {
        const clientNameInput = document.getElementById('clientInput').value.trim();
        if (!clientNameInput) {
            console.error('Client name input is empty.');
            return;
        }
        state.selectedDrive = getSharedDrivePath(clientNameInput);
        console.log('Selected Drive Path:', state.selectedDrive);
    });

    document.getElementById('searchButton').addEventListener('click', () => {
        const clientName = document.getElementById('clientInput').value;
        if (clientName) {
            searchForClient(clientName, false);
        }
    });

    document.getElementById('refresh').addEventListener('click', () => {
        const clientName = document.getElementById('clientInput').value;
        if (clientName === '') {
            console.log('refreshed');
            return;
        }
        searchForClient(clientName, true);
    });

    initDriveToggle();
    initClientAutocomplete();
    initClientFolderSizeSearch();
    initCreationTypeListing();
}

module.exports = {
    searchForClient,
    renderProjectView,
    getBaseDirectories,
    readAndProcessXmlConfig,
    initClientSearch,
};
