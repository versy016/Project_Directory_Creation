'use strict';

const { ipcRenderer, shell } = require('electron');

const { state } = require('./state');
const { ffsConfigPath } = require('../core/paths');
const { normaliseProjectName, isValidProjectName } = require('../core/project-name');
const ffsConfig = require('../core/ffs-config');
const { readExistingXmlConfig, writeXmlConfig } = require('../services/fs-repo');
const { searchIndices } = require('../services/algolia');
const { createProject: createProjectOnDisk } = require('../services/project-service');
const { getSharedDrivePath } = require('./major-clients');
const { collectSyncSettings } = require('./sync-controls');
const { searchForClient } = require('./client-search');
const { invalidateProjectIndex } = require('./project-search');

/**
 * The new-project form.
 *
 * This module is now DOM only: it reads the form into a plain request object,
 * validates it, and hands it to services/project-service, which owns everything
 * that touches the filesystem. Nothing here knows a drive path.
 *
 * Importing client-search here is safe and not a cycle: client-search does not
 * import this module. Only project-tables needed the injection treatment, because
 * client-search does import that.
 */

function clearForm() {
    document.getElementById('clientInput1').value = ' ';
    document.getElementById('newProjectName').value = ' ';
    document.getElementById('createtransin').checked = false;
    document.getElementById('createtransout').checked = false;
}

/**
 * Open the new-project form pre-filled with a tender name.
 * Called from an inline onclick emitted by project-tables, so it must be on window.
 */
function createProject(projectName) {
    // NOTE: script.js also assigned `clientName = ...` here with no declaration,
    // creating an implicit global. The value was never read (the code uses a
    // separate `clientInput` const below) and under a strict-mode module it would
    // throw, so the dead assignment is dropped.
    document.getElementById('newProjectSection').style.display = 'table-row';
    document.getElementById('newProjectButton').style.display = 'none';
    document.getElementById('checkboxcopytransin').style.display = 'block';
    document.getElementById('checkboxcopyohs').style.display = 'block';
    document.getElementById('newProjectButton').textContent = 'Create New Project';

    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        if (radio.value !== 'clientProject') {
            return;
        }

        radio.checked = true;
        document.getElementById('projecttypes').style.display = 'block';
        document.getElementById('newProjectName').value = projectName;
        document.getElementById('Heading').textContent = 'Existing Projects:';
        document.getElementById('cDriveHeading').textContent = 'C Drive Projects:';
        document.getElementById('gDriveHeading').textContent = 'G Drive Projects:';

        const clientInput = document.getElementById('clientInput').value.trim();
        if (clientInput) {
            searchForClient(clientInput, true);
        }
    });
}

/** Read the form into the plain request object project-service expects. */
function readNewProjectForm() {
    const newProjectNameInput = document.getElementById('newProjectName');

    // The dispatchEvent is kept where it was: it re-fires the tender autocomplete
    // handler off the raw input value.
    const projectName = normaliseProjectName(newProjectNameInput.value);
    newProjectNameInput.dispatchEvent(new Event('input'));

    const projectType = ['standard', 'dit', 'rpas']
        .map((id) => document.getElementById(id))
        .find((radio) => radio.checked);

    return {
        clientName: document.getElementById('clientInput').value.trim(),
        projectName,
        creationType: document.querySelector('input[name="creationType"]:checked').value,
        selectedDrive: state.selectedDrive,
        projectType: projectType ? projectType.value : null,
        copyToShared: document.getElementById('copyToGDrive').checked,
        transIn: {
            create: document.getElementById('createtransin').checked,
            dateLabel: document.getElementById('datePlaceholder').textContent,
        },
        transOut: {
            create: document.getElementById('createtransout').checked,
            dateLabel: document.getElementById('datePlaceholder1').textContent,
        },
        syncPair: {
            create: document.getElementById('createSyncFolderPair').checked,
            direction: document.querySelector('.newdirection-dropdown').value,
        },
        copyTransInFromQuote: document.getElementById('copytransin').checked,
        copyOhsFromQuote: document.getElementById('copyohs').checked,
    };
}

/** @returns {string|null} the message to show, or null when the request is valid. */
function validateRequest(request) {
    if (!request.clientName) {
        return 'Please enter a client name.';
    }
    if (!request.projectName) {
        return 'Please enter a project name.';
    }
    if (!isValidProjectName(request.projectName)) {
        return 'Invalid project name format. It must start with "YYYY_", "E" followed by 8 digits, or "C" followed by 8 digits.';
    }
    return null;
}

/** The Submit button: read the form, hand it to the service, refresh. */
async function submitNewProject(event) {
    event.preventDefault();

    const request = readNewProjectForm();

    const problem = validateRequest(request);
    if (problem) {
        ipcRenderer.send('show-custom-alert', problem);
        return;
    }

    // Preserved: the missing-project-type case uses a native alert, not the custom
    // modal, and only applies to client projects.
    if (request.creationType === 'clientProject' && !request.projectType) {
        alert('Please select a project type.');
        return;
    }

    try {
        await createProjectOnDisk(request, {
            notify: (message) => ipcRenderer.send('show-custom-alert', message),
            resolveSharedRoot: getSharedDrivePath,
        });
        clearForm();
        // The project search reads the drives, so a project just created has to
        // invalidate that cache or it stays invisible until the app restarts.
        invalidateProjectIndex();
    } catch (error) {
        console.error('Error creating project:', error);
        ipcRenderer.send('show-custom-alert', 'An error occurred while creating the project.');
    }

    if (request.clientName) {
        searchForClient(request.clientName, true);
    }
}


/** Create Folder Pairs: write the ticked rows into the .ffs_gui. */
async function runSync() {
    const clientName = document.getElementById('clientInput').value.trim();
    if (!clientName) {
        ipcRenderer.send('show-custom-alert', 'Please enter a client name');
        return;
    }

    const projects = collectSyncSettings();
    if (projects.length === 0) {
        ipcRenderer.send('show-custom-alert', 'No projects selected for synchronization');
        return;
    }

    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    const xmlConfigPath = ffsConfigPath(selectedCreationType, state.selectedDrive);
    const existingXmlConfig = await readExistingXmlConfig(xmlConfigPath);
    const existingPairsSet = ffsConfig.parseExistingPairsToSet(existingXmlConfig);

    const folderPairsXml = ffsConfig.generateFolderPairsXml({
        clientName,
        projects,
        existingPairsSet,
        creationType: selectedCreationType,
        selectedDrive: state.selectedDrive,
    });

    const updatedXmlConfig = existingXmlConfig
        ? ffsConfig.appendFolderPairsToExistingXml(existingXmlConfig, folderPairsXml)
        : ffsConfig.createFullXmlConfig(folderPairsXml);

    try {
        await writeXmlConfig(xmlConfigPath, updatedXmlConfig);
        ipcRenderer.send('show-custom-alert', 'Folder Pairs have been created.');
    } catch (error) {
        console.error('Failed to write XML configuration or execute sync:', error);
        ipcRenderer.send(
            'show-custom-alert',
            'An error occurred while setting up the synchronization.'
        );
    }

    document.querySelectorAll('.direction-dropdown').forEach((dropdown) => {
        dropdown.value = 'Update Right'; // C to G, matching the default elsewhere
    });
    document.querySelectorAll('.sync-checkbox').forEach((checkbox) => {
        checkbox.checked = false;
    });

    searchForClient(clientName, true);
}

/** Tender autocomplete on the project-name field. */
function initTenderAutocomplete() {
    const newProjectName = document.getElementById('newProjectName');
    const newProjectNameDropdown = document.getElementById('newProjectNameDropdown');

    newProjectName.addEventListener('input', function () {
        const query = this.value;

        if (query.length < 2) {
            newProjectNameDropdown.innerHTML = '';
            return;
        }

        searchIndices.tenders
            .search(query, { hitsPerPage: 30 })
            .then(({ hits }) => {
                newProjectNameDropdown.innerHTML =
                    '<ul>' +
                    hits
                        .map(
                            (hit) =>
                                `<li data-reference="${hit.reference}_${hit.name}">${hit.reference} ${hit.name} (${hit.client_name})</li>`
                        )
                        .join('') +
                    '</ul>';
            })
            .catch((err) => {
                console.error('Algolia search error: ', err);
            });
    });

    newProjectNameDropdown.addEventListener('click', function (e) {
        if (e.target.tagName === 'LI') {
            newProjectName.value = e.target.getAttribute('data-reference');
            newProjectNameDropdown.innerHTML = '';
        }
    });
}

/** Labels and headings that change between project and quote mode. */
function initModeLabels() {
    const copyToGDriveLabel = document.querySelector('label[for="copyToGDrive"]');

    function updateLabels() {
        const isQuote =
            document.querySelector('input[name="creationType"]:checked').value === 'quoteDirectory';

        copyToGDriveLabel.textContent = isQuote
            ? 'Copy quote to G Drive'
            : 'Copy project to G Drive';

        document.getElementById('Heading').textContent = isQuote
            ? 'Existing Quotes:'
            : 'Existing Projects:';
        document.getElementById('cDriveHeading').textContent = isQuote
            ? 'C Drive Quotes:'
            : 'C Drive Projects:';
        document.getElementById('gDriveHeading').textContent = isQuote
            ? 'G Drive Quotes:'
            : 'G Drive Projects:';
        document.getElementById('newProjectButton').textContent = isQuote
            ? 'Create New Quote'
            : 'Create New Project';
        document.getElementById('newProjectNameid').textContent = isQuote
            ? 'New Quote Name'
            : 'New Project Name';

        document.getElementById('checkboxcopytransin').style.display = 'none';
        document.getElementById('checkboxcopyohs').style.display = 'none';
        document.getElementById('copytransin').checked = false;
        document.getElementById('copyohs').checked = false;
    }

    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            updateLabels();

            const clientInput = document.getElementById('clientInput').value.trim();
            if (clientInput) {
                searchForClient(clientInput, true);
            }
        });
    });

    // Only the copyToGDrive label was initialised on load originally; the headings
    // start correct in the markup.
    copyToGDriveLabel.textContent =
        document.querySelector('input[name="creationType"]:checked').value === 'quoteDirectory'
            ? 'Copy quote to G Drive'
            : 'Copy project to G Drive';
}

function initNewProjectForm() {
    document.getElementById('btnSubmit').addEventListener('click', submitNewProject);
    document.getElementById('runSyncButton').addEventListener('click', runSync);

    document.getElementById('createSyncFolderPair').addEventListener('change', (event) => {
        document.getElementById('directioncell').style.display = event.target.checked
            ? 'flex'
            : 'none';
    });

    document.getElementById('newProjectButton').addEventListener('click', () => {
        document.getElementById('newProjectSection').style.display = 'table-row';
        document.getElementById('newProjectButton').style.display = 'none';
    });

    document.getElementById('hideNewProjectSectionButton').addEventListener('click', () => {
        document.getElementById('newProjectSection').style.display = 'none';
        document.getElementById('newProjectButton').style.display = 'table-row';
    });

    // The two links are one toggle: whichever mode you are NOT in is the link,
    // and #nameSourceMode names the one you are in. Keep both in step, or the
    // label ends up describing the wrong source.
    function setNameSource(mode) {
        document.getElementById('nameSourceMode').textContent = mode;
    }

    document.getElementById('enterManually').addEventListener('click', function (event) {
        event.preventDefault();
        document.getElementById('newProjectName').value = `${new Date().getFullYear()}_`;
        document.getElementById('newProjectNameDropdown').classList.remove('active');
        this.style.display = 'none';
        document.getElementById('SearchProject').style.display = 'inline';
        setNameSource('Manual entry');
    });

    document.getElementById('SearchProject').addEventListener('click', function (event) {
        event.preventDefault();
        document.getElementById('newProjectName').value = '';
        document.getElementById('newProjectNameDropdown').classList.add('active');
        this.style.display = 'none';
        document.getElementById('enterManually').style.display = 'inline';
        setNameSource('Search ESE quotes');
    });

    document.getElementById('openfile').addEventListener('click', async () => {
        const selectedCreationType = document.querySelector(
            'input[name="creationType"]:checked'
        ).value;

        const result = await shell.openPath(
            ffsConfigPath(selectedCreationType, state.selectedDrive)
        );
        if (result) {
            console.error('Failed to open file:', result);
            ipcRenderer.send('show-custom-alert', 'An error occurred while opening the file.');
        }
    });

    initTenderAutocomplete();
    initModeLabels();
}

module.exports = { initNewProjectForm, createProject, clearForm };
