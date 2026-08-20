'use strict';

/**
 * The middle column between the two project tables: one sync-direction dropdown
 * and a Sync checkbox per project that exists on both drives.
 *
 * Pure DOM -- no filesystem, no shared app state, no path knowledge. That is why
 * this was one of the first modules to come out of script.js.
 */

/**
 * Render one control per common project.
 *
 * A project that already has a folder pair in the .ffs_gui shows its configured
 * direction and is locked (both the dropdown and the checkbox are disabled), so
 * you cannot queue a duplicate pair.
 *
 * @param {string[]} commonProjects projects present on both drives, in table order
 * @param {Array<{cDriveProject: string, gDriveProject: string, variantSymbol: string}>} configData
 */
function populateDirectionColumn(commonProjects, configData) {
    const directionElement = document.getElementById('directionColumn');
    if (!directionElement) {
        return;
    }

    directionElement.innerHTML = commonProjects
        .map((projectName) => {
            // QUIRK (preserved): this is a substring match, so a project whose name
            // is contained in another project's name can pick up the wrong pair.
            const folderPair = configData.find(
                (pair) =>
                    pair.cDriveProject.includes(projectName) ||
                    pair.gDriveProject.includes(projectName)
            );

            const variantSymbol = folderPair ? folderPair.variantSymbol : '';
            const disabled = folderPair ? 'disabled' : '';

            let directionValue;
            switch (variantSymbol) {
                case '>': directionValue = 'Update Right'; break;
                case '<': directionValue = 'Update Left'; break;
                case '<>': directionValue = 'Update Both'; break;
                // Default is C to G. A pair with no existing config should push
                // local work up to the shared drive, not sync both ways.
                default: directionValue = 'Update Right';
            }

            return `
                <div class="direction-cell" data-project-name="${projectName}">
                    <select class="direction-dropdown" ${disabled}>
                        <option value="Update Right" ${directionValue === 'Update Right' ? 'selected' : ''}>></option>
                        <option value="Update Left" ${directionValue === 'Update Left' ? 'selected' : ''}><</option>
                        <option value="Update Both" ${directionValue === 'Update Both' ? 'selected' : ''}><></option>
                    </select>
                    <label>
                        Sync <input type="checkbox" class="sync-checkbox" ${folderPair ? 'checked disabled' : ''}>
                    </label>
                </div>`;
        })
        .join('');

    requestAnimationFrame(alignDirectionCellsWithRows);
}

/**
 * Read back the ticked rows as {name, direction} for the XML generator.
 */
function collectSyncSettings() {
    const projects = [];

    document.querySelectorAll('.direction-cell').forEach((cell) => {
        const syncCheckbox = cell.querySelector('.sync-checkbox');
        if (!syncCheckbox.checked) {
            return;
        }

        projects.push({
            name: cell.getAttribute('data-project-name'),
            direction: cell.querySelector('.direction-dropdown').value,
            syncEnabled: true,
        });
    });

    return projects;
}

/**
 * Absolutely position each control to sit centred on its C-drive table row.
 *
 * This is why partitionProjects puts common projects first in BOTH columns: the
 * pairing here is purely positional, cell[i] against row[i].
 */
function alignDirectionCellsWithRows() {
    const directionColumn = document.getElementById('directionColumn');
    const cDriveTable = document.getElementById('cDriveTable');

    if (!directionColumn || !cDriveTable) {
        return;
    }

    const cDriveRows = Array.from(cDriveTable.querySelectorAll('tbody tr'));
    const directionCells = Array.from(directionColumn.querySelectorAll('.direction-cell'));

    if (!cDriveRows.length || !directionCells.length) {
        return;
    }

    directionColumn.style.height = `${cDriveTable.offsetHeight}px`;

    const columnRect = directionColumn.getBoundingClientRect();
    const count = Math.min(cDriveRows.length, directionCells.length);

    for (let i = 0; i < count; i++) {
        const row = cDriveRows[i];
        const cell = directionCells[i];
        const cellHeight = cell.offsetHeight || 24;

        cell.style.top = `${
            row.getBoundingClientRect().top - columnRect.top +
            (row.offsetHeight - cellHeight) / 2
        }px`;
    }
}

function initSyncControls() {
    window.addEventListener('resize', () => {
        requestAnimationFrame(alignDirectionCellsWithRows);
    });
}

module.exports = {
    populateDirectionColumn,
    collectSyncSettings,
    alignDirectionCellsWithRows,
    initSyncControls,
};
