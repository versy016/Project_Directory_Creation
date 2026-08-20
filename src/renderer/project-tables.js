'use strict';

const path = require('path');
const { ipcRenderer } = require('electron');
const { shell } = require('electron');

const { state } = require('./state');
const { roots } = require('../config/roots');
const { projectExists } = require('../services/fs-repo');

/**
 * The two drive tables and the buttons in their rows.
 *
 * DEPENDENCY DIRECTION
 * --------------------
 * This module renders rows; client-search decides what to render. But copying a
 * project has to refresh the tables afterwards, which is client-search's job --
 * so a naive split gives project-tables -> client-search -> project-tables, a
 * require cycle that fails at load.
 *
 * The edge is inverted at init instead: client-search hands its refresh function
 * in via `initProjectTables({ onProjectsChanged })`. Nothing here imports
 * client-search.
 *
 * The row buttons use inline onclick attributes, which execute in the page's MAIN
 * world -- while this module runs in the preload's isolated world. So
 * `copyProject`, `copyFoldersOnly` and `createProject` are not reachable from
 * those attributes unless preload.js bridges them across with `contextBridge`.
 * Assigning them to `window` here would silently do nothing: it would land on the
 * isolated world's window and every table button would become a no-op with no
 * error. The smoke test asserts they are present in the main world.
 *
 * `createProject` deliberately lives in new-project-form, not here: it opens and
 * pre-fills that form rather than rendering anything. This module only emits the
 * onclick that names it.
 */

let onProjectsChanged = () => {};

const greyButton = (label) =>
    `<td><button class = "copyProjectButton" style="font-size: 14px; color: white; background-color: grey; cursor: not-allowed; border: none; padding: 5px 10px;" disabled>${label}</button></td>`;

function generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo) {
    const safeCopyFromPath = copyFromPath.replace(/\\/g, '\\\\');
    const safeCopyToPath = copyToPath.replace(/\\/g, '\\\\');
    return `<td><button class="copyToButton" style="font-size: 14px; color: white; background-color: #4CAF50; cursor: pointer; border: none; padding: 5px 10px;" onclick="copyProject('${project}', '${safeCopyFromPath}', '${safeCopyToPath}')">Copy to ${copyTo}</button></td>`;
}

function generateFoldersOnlyButtonHTML(project, copyFromPath, copyToPath, copyTo) {
    const safeCopyFromPath = copyFromPath.replace(/\\/g, '\\\\');
    const safeCopyToPath = copyToPath.replace(/\\/g, '\\\\');
    return `<td><button class="copyFoldersButton" style="font-size: 14px; color: white; background-color: #607D8B; cursor: pointer; border: none; padding: 5px 10px;" onclick="copyFoldersOnly('${project}', '${safeCopyFromPath}', '${safeCopyToPath}')">Folders to ${copyTo}</button></td>`;
}

/**
 * Render one drive's project rows.
 *
 * @param {string[]} projectList projects to show, already ordered
 * @param {string} elementId  'cDriveProjects' or 'gDriveProjects'
 * @param {string} basePath   the drive+client folder these projects live in.
 *                            (In script.js this parameter was confusingly named
 *                            `clientName`; it is a path, not a name.)
 */
async function populateProjects(projectList, elementId, basePath) {
    const clientInput = document.getElementById('clientInput').value.trim();
    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    const enableCreateProject = selectedCreationType === 'quoteDirectory';

    const projectElement = document.getElementById(elementId);
    if (!projectElement) {
        console.error(`Element with ID '${elementId}' not found.`);
        return;
    }

    const basePathCPrimary = path.join(roots.localClients, clientInput);
    const basePathGPrimary = path.join(state.selectedDrive, clientInput);
    const basePathCQuotes = path.join(roots.localAccounts, clientInput);
    const basePathGQuotes = path.join(roots.sharedQuotes, clientInput);

    // Guard preserved from script.js: bail out when called with a bare drive root
    // rather than a client folder, which the creationType radio handlers still do.
    if (
        clientInput === '' ||
        basePath === roots.localClients ||
        basePath === state.selectedDrive ||
        basePath === roots.localAccounts ||
        basePath === roots.sharedQuotes
    ) {
        return;
    }

    const projectRows = await Promise.all(
        projectList.map(async (project) => {
            const existsInCPrimary = await projectExists(basePathCPrimary, project);
            const existsInGPrimary = await projectExists(basePathGPrimary, project);
            const existsInCQuotes = await projectExists(basePathCQuotes, project);
            const existsInGQuotes = await projectExists(basePathGQuotes, project);

            let projectActionHTML;
            if (existsInCPrimary || existsInGPrimary || !enableCreateProject) {
                projectActionHTML = greyButton('Create Project');
            } else {
                projectActionHTML = `<td><button class = "copyProjectButton" style="font-size: 14px; color: white; background-color: #3F51B5; cursor: pointer; border: none; padding: 5px 10px;" onclick="document.getElementById('copytransin').checked = true; document.getElementById('copyohs').checked = true; createProject('${project}')">Create Project</button></td>`;
            }

            let copyButtonHTML = '';
            let foldersButtonHTML = '';

            // A copy button only makes sense when the project is on exactly one side.
            if (selectedCreationType === 'clientProject' && existsInCPrimary !== existsInGPrimary) {
                const copyTo = existsInCPrimary ? state.driveSymbol : 'C';
                const copyFromPath = existsInCPrimary ? basePathCPrimary : basePathGPrimary;
                const copyToPath = existsInCPrimary ? basePathGPrimary : basePathCPrimary;
                copyButtonHTML = generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo);
                foldersButtonHTML = generateFoldersOnlyButtonHTML(project, copyFromPath, copyToPath, copyTo);
            } else if (
                selectedCreationType === 'quoteDirectory' &&
                existsInCQuotes !== existsInGQuotes
            ) {
                const copyTo = existsInCQuotes ? state.driveSymbol : 'C';
                const copyFromPath = existsInCQuotes ? basePathCQuotes : basePathGQuotes;
                const copyToPath = existsInCQuotes ? basePathGQuotes : basePathCQuotes;
                copyButtonHTML = generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo);
                foldersButtonHTML = generateFoldersOnlyButtonHTML(project, copyFromPath, copyToPath, copyTo);
            }

            // Empty placeholder cells keep the two tables the same width.
            if (copyButtonHTML === '') {
                copyButtonHTML = `<td><button class="copyToButton" style="padding: 0;" ></button></td>`;
                foldersButtonHTML = `<td><button class="copyFoldersButton" style="padding: 0;" ></button></td>`;
            }

            const dataPath = path.join(basePath, project);
            if (dataPath.includes(basePathCPrimary) || dataPath.includes(basePathGPrimary)) {
                projectActionHTML = '';
            }

            return `<tr>
                        <td>${project}</td>
                        <td><button class="open-folder-btn" data-path="${dataPath}">Open</button></td>
                        ${projectActionHTML}
                        ${copyButtonHTML}
                        ${foldersButtonHTML}
                     </tr>`;
        })
    );

    projectElement.innerHTML = projectRows.join('');
}

/** Full copy of one project to the other drive, then refresh. */
async function copyProject(projectName, fromPath, toPath) {
    const clientInput = document.getElementById('clientInput').value.trim();

    try {
        await ipcRenderer.invoke('show-copying-in-progress');
        await ipcRenderer.invoke('copy-directory', { projectName, fromPath, toPath });
        await ipcRenderer.invoke('close-copying-in-progress');
        onProjectsChanged(clientInput, true);
        console.log(`Project '${projectName}' has been successfully copied.`);
    } catch (error) {
        console.error(`Error copying project '${projectName}':`, error);
        await ipcRenderer.invoke('close-copying-in-progress');
    }
}

/** Directory structure only, no files. */
async function copyFoldersOnly(projectName, fromPath, toPath) {
    const clientInput = document.getElementById('clientInput').value.trim();

    try {
        await ipcRenderer.invoke('show-copying-in-progress');
        await ipcRenderer.invoke('copy-folders-only', { projectName, fromPath, toPath });
        await ipcRenderer.invoke('close-copying-in-progress');
        onProjectsChanged(clientInput, true);
        console.log(`Folders for project '${projectName}' have been created at destination.`);
    } catch (error) {
        console.error(`Error copying folders for project '${projectName}':`, error);
        await ipcRenderer.invoke('close-copying-in-progress');
    }
}

/**
 * @param {{onProjectsChanged: (clientName: string, refresh: boolean) => void}} deps
 */
function initProjectTables(deps = {}) {
    if (typeof deps.onProjectsChanged === 'function') {
        onProjectsChanged = deps.onProjectsChanged;
    }

    for (const tableId of ['cDriveTable', 'gDriveTable']) {
        document.getElementById(tableId).addEventListener('click', (event) => {
            if (event.target.classList.contains('open-folder-btn')) {
                shell.openPath(event.target.getAttribute('data-path'));
            }
        });
    }
}

module.exports = { populateProjects, copyProject, copyFoldersOnly, initProjectTables };
