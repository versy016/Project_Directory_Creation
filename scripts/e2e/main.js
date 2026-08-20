'use strict';

/**
 * Behavioural end-to-end test. Launched by scripts/e2e.js, which builds the
 * sandbox and sets the PDC_* environment first.
 *
 * Loads the REAL index.html and drives it the way a user would -- fill the client
 * box, click Search, tick a sync checkbox, click Create Folder Pairs, create a
 * project -- then asserts against the actual files on the sandbox drives.
 *
 * This is what `npm run smoke` cannot do. Smoke proves the renderer loads; this
 * proves it still behaves. It exists because splitting script.js into modules
 * moves shared mutable state (selected_drive, drive_symbol, majorClients) across
 * module boundaries, and getting that wrong produces bugs that load cleanly.
 *
 * It stands in for the parts of main.js the renderer talks to over IPC.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const fsExtra = require('fs-extra');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SANDBOX = process.env.PDC_E2E_SANDBOX;

app.disableHardwareAcceleration();

const alerts = [];
const results = [];
let win;

// --- stand-ins for the channels main.js normally serves ----------------------

ipcMain.on('show-custom-alert', (event, message) => alerts.push(message));
ipcMain.on('show-dialog', (event, args) => alerts.push(args && args.message));
ipcMain.on('refresh-app', () => {});
ipcMain.on('focus-fix', () => {});
ipcMain.handle('show-message-box', async () => ({ response: 0 }));
ipcMain.handle('show-copying-in-progress', async () => {});
ipcMain.handle('close-copying-in-progress', async () => {});

ipcMain.handle('copy-directory', async (event, { projectName, fromPath, toPath }) => {
  const destination = path.join(toPath, projectName);
  await fsExtra.ensureDir(path.dirname(destination));
  await fsExtra.copy(path.join(fromPath, projectName), destination);
});

ipcMain.handle('copy-folders-only', async (event, { projectName, fromPath, toPath }) => {
  const destination = path.join(toPath, projectName);
  await fsExtra.ensureDir(path.dirname(destination));
  await fsExtra.copy(path.join(fromPath, projectName), destination, {
    filter: (src) => {
      try {
        return fs.lstatSync(src).isDirectory();
      } catch (error) {
        return false;
      }
    },
  });
});

// --- helpers -----------------------------------------------------------------

const js = (expression) => win.webContents.executeJavaScript(expression);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await js(`Boolean(${expression})`)) return true;
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function check(label, condition, detail) {
  results.push({ label, ok: Boolean(condition), detail });
}

const sandboxPath = (...parts) => path.join(SANDBOX, ...parts);
const exists = (...parts) => fs.existsSync(sandboxPath(...parts));

// --- the scenarios -----------------------------------------------------------

async function searchPopulatesBothTables() {
  await js(`document.getElementById('clientInput').value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);

  await waitFor(
    `document.querySelectorAll('#cDriveProjects tr').length > 0`,
    'the C-drive table to populate'
  );
  await sleep(400);

  const cRows = await js(
    `Array.from(document.querySelectorAll('#cDriveProjects tr td:first-child')).map(td => td.textContent)`
  );
  const gRows = await js(
    `Array.from(document.querySelectorAll('#gDriveProjects tr td:first-child')).map(td => td.textContent)`
  );
  const directionCells = await js(`document.querySelectorAll('.direction-cell').length`);

  check('C table lists the shared and local-only projects',
    cRows.includes('2024_Shared') && cRows.includes('2023_LocalOnly'), cRows.join(', '));
  check('G table lists the shared and shared-only projects',
    gRows.includes('2024_Shared') && gRows.includes('2022_SharedOnly'), gRows.join(', '));
  check('common project leads both columns so rows align',
    cRows[0] === '2024_Shared' && gRows[0] === '2024_Shared', `${cRows[0]} / ${gRows[0]}`);
  check('one sync control, for the one common project', directionCells === 1, `${directionCells} cells`);

  // Proves the _<Letter> bucketing ran (ACME is not a major client) using only
  // what the UI rendered -- deliberately not by reading selected_drive, so this
  // stays valid once that state moves into a module.
  const gOpenPath = await js(
    `document.querySelector('#gDriveProjects .open-folder-btn').getAttribute('data-path')`
  );
  check('shared-drive rows resolve through the _A bucket',
    gOpenPath === sandboxPath('G', '_A', 'ACME', '2024_Shared'), gOpenPath);
}

/**
 * Major clients skip the _<Letter> bucketing and live directly under the shared
 * base. This exercises loadMajorClients end to end.
 *
 * Added after a refactor broke `jsonData.majorClients`, leaving the list silently
 * empty. Every existing check still passed, because ACME is not a major client and
 * routes identically either way -- the only visible symptom was a console line.
 * With this scenario, an empty list fails loudly.
 */
async function majorClientSkipsLetterBucketing() {
  await js(`document.getElementById('clientInput').value = 'FULTON HOGAN'`);
  await js(`document.getElementById('searchButton').click()`);

  await waitFor(
    `document.querySelectorAll('#gDriveProjects tr').length > 0`,
    'the major-client search to render'
  );
  await sleep(400);

  const gOpenPath = await js(
    `document.querySelector('#gDriveProjects .open-folder-btn').getAttribute('data-path')`
  );

  check('major client resolves directly under the shared base, not _F',
    gOpenPath === sandboxPath('G', 'FULTON HOGAN', '2024_MajorShared'), gOpenPath);
  check('and specifically NOT into a letter bucket',
    !gOpenPath.includes(`${path.sep}_F${path.sep}`), gOpenPath);

  // Put the client box back for the scenarios that follow.
  await js(`document.getElementById('clientInput').value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);
  await sleep(800);
}

async function createFolderPairWritesXml() {
  await js(`document.querySelector('.direction-cell .sync-checkbox').checked = true`);
  await js(`document.querySelector('.direction-cell .direction-dropdown').value = 'Update Right'`);
  await js(`document.getElementById('runSyncButton').click()`);
  await sleep(1500);

  const xml = fs.readFileSync(sandboxPath('ffs', 'SyncSettings.ffs_gui'), 'utf-8');
  const expectedLeft = path.join(sandboxPath('C', '_Clients'), 'ACME', '2024_Shared');

  check('a folder pair was written to the .ffs_gui', xml.includes('<Pair>'));
  check('the pair points at the real local project path',
    xml.includes(`<Left>${expectedLeft}</Left>`), expectedLeft);

  // Quirk #15, observable: getSharedDrivePath is the only path builder in the app
  // that emits a forward slash, and generateFolderPairsXml uses template literals
  // rather than path.join -- so the separator survives into the config file.
  // Pinned in that exact shape: normalising it must be a deliberate decision.
  const expectedRight = `${sandboxPath('G')}/_A\\ACME\\2024_Shared`;
  check('the shared side keeps its mixed separators (quirk #15)',
    xml.includes(`<Right>${expectedRight}</Right>`), expectedRight);
  check('the config is still well-formed around the insert',
    xml.includes('<GridViewType>Action</GridViewType>') && xml.includes('</FolderPairs>'));
  check('no undefined leaked into the config (bug #1 guard)', !xml.includes('undefined'));
}

async function createProjectBuildsFromTemplate() {
  await js(`document.getElementById('newProjectButton').click()`);
  await js(`document.getElementById('newProjectName').value = '2024_E2ECreated'`);
  await js(`document.getElementById('standard').checked = true`);
  await js(`document.getElementById('copyToGDrive').checked = true`);
  await js(`document.getElementById('createSyncFolderPair').checked = false`);
  await js(`document.getElementById('btnSubmit').click()`);
  await sleep(3000);

  check('project created on the local drive',
    exists('C', '_Clients', 'ACME', '2024_E2ECreated'));
  check('standard template contents copied in',
    exists('C', '_Clients', 'ACME', '2024_E2ECreated', 'readme.txt'));
  check('template subfolders copied in',
    exists('C', '_Clients', 'ACME', '2024_E2ECreated', 'TransIn'));
  check('project copied to the bucketed shared drive',
    exists('G', '_A', 'ACME', '2024_E2ECreated'));
  check('DIT overlay NOT applied for a Standard project',
    !exists('C', '_Clients', 'ACME', '2024_E2ECreated', 'dit-marker.txt'));
  check('the shared template was left clean',
    !exists('G', 'templates', '_Standard', 'TransIn', '2024_E2ECreated'));
}

/**
 * The dated TransIn / TransOut folders.
 *
 * Today these are created inside the SHARED template so the template copy picks
 * them up, then deleted from the template again afterwards. This scenario asserts
 * the OUTCOME rather than the mechanism -- the folders land in the new project on
 * both drives, and the shared template is left exactly as it was found.
 *
 * That distinction is the point: Phase 4 replaces the mechanism (stage locally
 * instead of mutating a shared network directory), and these assertions must keep
 * passing unchanged across that change.
 */
async function datedTransferFoldersLandInTheProject() {
  const dateLabel = await js(`document.getElementById('datePlaceholder').textContent`);
  const dateLabelOut = await js(`document.getElementById('datePlaceholder1').textContent`);

  await js(`document.getElementById('newProjectButton').click()`);
  await js(`document.getElementById('newProjectName').value = '2024_TransferTest'`);
  await js(`document.getElementById('standard').checked = true`);
  await js(`document.getElementById('copyToGDrive').checked = true`);
  await js(`document.getElementById('createSyncFolderPair').checked = false`);
  await js(`document.getElementById('createtransin').checked = true`);
  await js(`document.getElementById('createtransout').checked = true`);
  await js(`document.getElementById('btnSubmit').click()`);
  await sleep(3500);

  const project = ['C', '_Clients', 'ACME', '2024_TransferTest'];

  check('dated TransIn folder created in the project',
    exists(...project, 'TransIn', dateLabel), `TransIn/${dateLabel}`);
  check('dated TransOut folder created in the project',
    exists(...project, 'TransOut', dateLabelOut), `TransOut/${dateLabelOut}`);
  check('dated folders reached the shared drive too',
    exists('G', '_A', 'ACME', '2024_TransferTest', 'TransIn', dateLabel));

  // The shared template must be exactly as it started -- no leftovers.
  check('shared template has no leftover dated TransIn',
    !exists('G', 'templates', '_Standard', 'TransIn', dateLabel));
  check('shared template has no leftover dated TransOut',
    !exists('G', 'templates', '_Standard', 'TransOut', dateLabelOut));

  await js(`document.getElementById('createtransin').checked = false`);
  await js(`document.getElementById('createtransout').checked = false`);
}

const MARKER_PAIR =
  '\n            <Pair>\n' +
  '                <Left>MARKER_LEFT</Left>\n' +
  '                <Right>MARKER_RIGHT</Right>\n' +
  '                <Synchronize>\n' +
  '                    <Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>\n' +
  '                    <DeletionPolicy>RecycleBin</DeletionPolicy>\n' +
  '                    <VersioningFolder Style="Replace"/>\n' +
  '                </Synchronize>\n' +
  '            </Pair>\n';

/**
 * The J: drive path, which had no automated coverage until now.
 *
 * Covers two things:
 *
 *  - **Bug #25 (fixed in Phase 2).** Creating a project on J used to read the G
 *    config, append to it, and write the result over SyncSettingsJdrive.ffs_gui --
 *    destroying every pair the J config held. A marker pair is seeded first, so a
 *    clobber is detectable rather than invisible.
 *
 *  - **Bug #27.** Creating a project while on J checks J for an existing project
 *    but copies to the G bucket, so it lands on the wrong drive.
 */
async function jDriveBehaviour() {
  const jConfigPath = sandboxPath('ffs', 'SyncSettingsJdrive.ffs_gui');
  fs.writeFileSync(
    jConfigPath,
    fs.readFileSync(jConfigPath, 'utf-8').replace('</FolderPairs>', `${MARKER_PAIR}</FolderPairs>`)
  );

  await js(`document.getElementById('clientInput').value = 'ACME'`);
  await js(`document.getElementById('driveToggle').checked = true`);
  await js(`document.getElementById('driveToggle').dispatchEvent(new Event('change'))`);
  await waitFor(
    `document.getElementById('gDriveHeading').textContent.includes('J Drive')`,
    'the J drive toggle to take effect'
  );
  await sleep(900);

  const jOpenPath = await js(
    `Array.from(document.querySelectorAll('#gDriveProjects .open-folder-btn'))
       .map(b => b.getAttribute('data-path'))`
  );
  check('the shared column lists projects from the J root',
    jOpenPath.some((p) => p === sandboxPath('J', 'ACME', '2021_JOnly')), jOpenPath.join(' | '));

  await js(`document.getElementById('newProjectButton').click()`);
  await js(`document.getElementById('newProjectName').value = '2024_JTest'`);
  await js(`document.getElementById('standard').checked = true`);
  await js(`document.getElementById('copyToGDrive').checked = true`);
  await js(`document.getElementById('createSyncFolderPair').checked = true`);
  await js(`document.querySelector('.newdirection-dropdown').value = 'Update Right'`);
  await js(`document.getElementById('btnSubmit').click()`);
  await sleep(3500);

  const jConfig = fs.readFileSync(jConfigPath, 'utf-8');
  const gConfig = fs.readFileSync(sandboxPath('ffs', 'SyncSettings.ffs_gui'), 'utf-8');

  check('bug #25 guard: the pre-existing J pair survived',
    jConfig.includes('MARKER_LEFT'), 'J config was clobbered');
  check('the new pair went into the J config', jConfig.includes('2024_JTest'));
  check('and NOT into the G config', !gConfig.includes('2024_JTest'));

  check('project created locally', exists('C', '_Clients', 'ACME', '2024_JTest'));
  check('project copied to the J drive',
    exists('J', 'ACME', '2024_JTest'),
    'expected the project on J');
  check('and NOT to the G bucket',
    !exists('G', '_A', 'ACME', '2024_JTest'),
    'project leaked onto the G drive');

  // Back to G for anything that follows.
  await js(`document.getElementById('createSyncFolderPair').checked = false`);
  await js(`document.getElementById('driveToggle').checked = false`);
  await js(`document.getElementById('driveToggle').dispatchEvent(new Event('change'))`);
  await sleep(900);
}

/**
 * The project search box, read from the drives.
 *
 * Client "UPC" + Project "2026" narrows to that client's 2026 jobs, and each row
 * reports where the project actually lives: Both, C, or G.
 */
async function projectSearchNarrowsByClientAndProject() {
  const input = `document.getElementById('projectSearchInput')`;
  const clientBox = `document.getElementById('clientInput')`;
  const items = `Array.from(document.querySelectorAll('#projectSearchDropdown li[data-client]'))`;
  const projects = `${items}.map(li => li.getAttribute('data-project'))`;
  const badges = `${items}.map(li => li.getAttribute('data-project') + '=' + li.querySelector('.project-search-drive').textContent)`;

  const typeProject = async (value) => {
    await js(`${input}.value = ${JSON.stringify(value)}`);
    await js(`${input}.dispatchEvent(new Event('input'))`);
    await sleep(700);
  };

  await js(`${clientBox}.value = 'UPC'`);
  await js(`${input}.value = ''`);

  // Nothing is suggested until two characters have been typed.
  await js(`${input}.dispatchEvent(new Event('focus'))`);
  await sleep(500);
  check('focusing an empty box suggests nothing', (await js(`${items}.length`)) === 0);

  await typeProject('2');
  check('one character still suggests nothing', (await js(`${items}.length`)) === 0);

  // The first keystroke past the threshold walks both drives.
  await typeProject('20');
  await waitFor(`${items}.length > 0`, 'the drive scan to finish');
  const twoChars = await js(projects);
  check('two characters start suggesting', twoChars.length === 3, twoChars.join(', '));

  await typeProject('2026');
  const narrowed = await js(projects);
  check('the client and project boxes narrow together',
    narrowed.length === 3, narrowed.join(', '));
  check('and nothing from another client',
    !narrowed.some((p) => p.includes('Shared') && p.includes('2024')), narrowed.join(', '));

  // The drive badge -- one project of each kind exists for this client.
  const withBadges = await js(badges);
  check('a project on both drives is badged Both',
    withBadges.includes('2026_UPJob=Both'), withBadges.join(', '));
  check('a local-only project is badged C',
    withBadges.includes('2026_LocalJob=C'), withBadges.join(', '));
  check('a shared-only project is badged G',
    withBadges.includes('2026_SharedJob=G'), withBadges.join(', '));

  // A shared-only project must be findable at all -- it exists on no local disk.
  check('shared-only projects appear in the list',
    narrowed.includes('2026_SharedJob'), narrowed.join(', '));

  // Selecting fills in the client above and runs the normal search.
  await js(`${clientBox}.value = ''`);
  const picked = await js(
    `document.querySelector('#projectSearchDropdown li[data-client]').getAttribute('data-project')`
  );
  await js(`document.querySelector('#projectSearchDropdown li[data-client]').click()`);
  await sleep(1600);

  // Folders are named by ES Reference, so the index already carries the value the
  // client box wants -- no name-to-reference lookup, unlike the Algolia version.
  check('selecting a project populates the client field with the ES Reference',
    (await js(`${clientBox}.value`)) === 'UPC', await js(`${clientBox}.value`));
  // The box now holds one project name, so the tables narrow to it -- same rule
  // as typing. Asserted against the project actually clicked rather than a fixed
  // name: the dropdown sorts by year then name, so the first row is whichever
  // project sorts first, not a particular one.
  const shownAfterPick = await js(
    `Array.from(document.querySelectorAll('#cDriveProjects tr td:first-child, #gDriveProjects tr td:first-child')).map(td => td.textContent)`
  );
  check('and runs the client search, narrowed to the project picked',
    shownAfterPick.includes(picked), `picked ${picked}, showing ${shownAfterPick.join(', ')}`);

  // Clearing the project box must leave the client alone.
  await typeProject('');
  check('clearing the project search does NOT clear the client',
    (await js(`${clientBox}.value`)) === 'UPC');
  check('and the suggestions are hidden again, not left stale',
    (await js(`${items}.length`)) === 0);

  // Same logic in Quote mode, against the quote folders.
  await js(`document.querySelector('input[name="creationType"][value="quoteDirectory"]').checked = true`);
  await js(
    `document.querySelector('input[name="creationType"][value="quoteDirectory"]')
       .dispatchEvent(new Event('change'))`
  );
  await sleep(900);

  check('switching to Quote mode relabels the search',
    (await js(`document.getElementById('projectSearchLabel').textContent`)) === 'Quote:');
  check('and does not clear the client',
    (await js(`${clientBox}.value`)) === 'UPC');

  await js(`${clientBox}.value = 'ACME'`);
  await typeProject('Quote');
  const quoteHits = await js(projects);
  check('quote mode lists quote folders, not project folders',
    quoteHits.includes('2024_QuoteOne') && !quoteHits.includes('2026_UPJob'),
    quoteHits.join(', ') || '(none)');

  // Back to client-project mode.
  await js(`document.querySelector('input[name="creationType"][value="clientProject"]').checked = true`);
  await js(
    `document.querySelector('input[name="creationType"][value="clientProject"]')
       .dispatchEvent(new Event('change'))`
  );
  await sleep(900);
  await js(`${clientBox}.value = 'ACME'`);
}

/**
 * The sort control over the project tables.
 *
 * ACME in the sandbox has 2024_Shared on both drives, 2023_LocalOnly and
 * 2020_Zulu on C only, and 2022_SharedOnly on G only.
 *
 * The filter chips were removed from the UI; the filtering logic behind them is
 * still covered by tests/core/project-filter.test.js.
 */
async function sortReordersTheTables() {
  const cRows = `Array.from(document.querySelectorAll('#cDriveProjects tr td:first-child')).map(td => td.textContent)`;
  const gRows = `Array.from(document.querySelectorAll('#gDriveProjects tr td:first-child')).map(td => td.textContent)`;

  const sortBy = async (value) => {
    await js(`document.getElementById('projectSortSelect').value = ${JSON.stringify(value)}`);
    await js(`document.getElementById('projectSortSelect').dispatchEvent(new Event('change'))`);
    await sleep(700);
  };

  await js(`document.getElementById('clientInput').value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);
  await waitFor(`${cRows}.length > 0`, 'the project tables');
  await sleep(600);

  check('the filter chips are gone',
    (await js(`document.querySelectorAll('.filter-chip').length`)) === 0);

  const byYear = await js(cRows);
  check('the default order is newest first, shared project leading',
    byYear[0] === '2024_Shared', byYear.join());

  await sortBy('nameAsc');
  const byName = await js(cRows);
  check('sorting by name reorders the rows', byName.join() !== byYear.join(),
    `${byYear.join()} -> ${byName.join()}`);
  check('and sorts WITHIN buckets, keeping the shared project first',
    byName[0] === '2024_Shared' && byName.slice(1).join() === '2020_Zulu,2023_LocalOnly',
    byName.join());
  check('the columns stay row-aligned after a re-sort',
    byName[0] === (await js(gRows))[0],
    'the sync controls are positioned by row index, so this must hold');

  await sortBy('yearAsc');
  const oldest = await js(cRows);
  check('oldest first reverses the order within each bucket',
    oldest.join() === '2024_Shared,2020_Zulu,2023_LocalOnly', oldest.join());

  await sortBy('yearDesc');
  check('switching back restores the original order',
    (await js(cRows)).join() === byYear.join());

  // The at-risk warning survives the chips being removed.
  const warningVisible = await js(
    `document.getElementById('projectAtRisk').style.display !== 'none'`
  );
  const warningText = await js(`document.getElementById('projectAtRisk').textContent`);
  check('an unsynced local-only project still raises the at-risk warning',
    warningVisible && /only on this PC/.test(warningText), warningText.trim());
  check('and it no longer offers a filter shortcut',
    (await js(`document.querySelectorAll('#projectAtRisk button').length`)) === 0);
}

/**
 * Paging. The sandbox client PAGED has 25 projects, against a page size of 10.
 */
async function pagingRevealsProjectsInSteps() {
  const cRows = `document.querySelectorAll('#cDriveProjects tr').length`;
  const pagerText = `document.getElementById('projectPagerCount').textContent`;
  const moreVisible = `document.getElementById('showMoreProjects').offsetParent !== null`;
  const allVisible = `document.getElementById('showAllProjects').offsetParent !== null`;

  const search = async (client) => {
    await js(`document.getElementById('clientInput').value = ${JSON.stringify(client)}`);
    await js(`document.getElementById('searchButton').click()`);
    await sleep(1200);
  };

  const clickMore = async () => {
    await js(`document.getElementById('showMoreProjects').click()`);
    await sleep(700);
  };

  await search('PAGED');

  check('only the first page is rendered', (await js(cRows)) === 10, `${await js(cRows)} rows`);
  check('the pager says how much is hidden',
    /Showing 10 of 25/.test(await js(pagerText)), await js(pagerText));
  check('Show more is offered', await js(moreVisible));
  check('Show all is NOT offered before expanding once',
    !(await js(allVisible)), 'it is noise on a first look');

  await clickMore();
  check('Show more adds a page', (await js(cRows)) === 20, `${await js(cRows)} rows`);
  check('and Show all appears once expanded', await js(allVisible));
  check('the count keeps up', /Showing 20 of 25/.test(await js(pagerText)), await js(pagerText));

  await clickMore();
  check('a further press reveals the remainder', (await js(cRows)) === 25);
  check('and the buttons retire once everything is shown',
    !(await js(moreVisible)) && !(await js(allVisible)));
  check('with the count confirming it',
    /Showing all 25/.test(await js(pagerText)), await js(pagerText));

  // Show all, from a partly expanded list.
  await js(`document.getElementById('projectResetView').click()`);
  await sleep(700);
  check('Reset view returns to the first page', (await js(cRows)) === 10);

  await clickMore();
  await js(`document.getElementById('showAllProjects').click()`);
  await sleep(900);
  check('Show all reveals everything at once', (await js(cRows)) === 25);

  // Reset also has to put the filter and sort back, not just the row count.
  await js(`document.getElementById('projectSortSelect').value = 'nameAsc'`);
  await js(`document.getElementById('projectSortSelect').dispatchEvent(new Event('change'))`);
  await sleep(700);
  await js(`document.getElementById('projectResetView').click()`);
  await sleep(700);
  check('Reset view restores the default sort too',
    (await js(`document.getElementById('projectSortSelect').value`)) === 'yearDesc');

  // Searching a different client resets the view without being asked.
  await clickMore();
  check('precondition: the list is expanded', (await js(cRows)) === 20);

  await search('ACME');
  await search('PAGED');
  check('searching a new client resets paging', (await js(cRows)) === 10, `${await js(cRows)} rows`);

  await search('ACME');
}

/**
 * The Project search box narrows the C, G and J tables, not just the dropdown.
 *
 * ACME in the sandbox: 2024_Shared on both drives, 2023_LocalOnly and 2020_Zulu
 * on C only, 2022_SharedOnly on G only, and 2021_JOnly on J. That spread is what
 * makes it possible to prove each column narrows on its own contents rather than
 * both being driven off the C-drive list.
 */
async function searchNarrowsTheDriveTables() {
  const cRows = `Array.from(document.querySelectorAll('#cDriveProjects tr td:first-child')).map(td => td.textContent)`;
  const gRows = `Array.from(document.querySelectorAll('#gDriveProjects tr td:first-child')).map(td => td.textContent)`;
  const input = `document.getElementById('projectSearchInput')`;
  const noteShown = `document.getElementById('projectQueryNote').style.display !== 'none'`;
  const noteText = `document.getElementById('projectQueryText').textContent`;

  const typeProject = async (value) => {
    await js(`${input}.value = ${JSON.stringify(value)}`);
    await js(`${input}.dispatchEvent(new Event('input'))`);
    await sleep(800);
  };

  await js(`document.getElementById('clientInput').value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);
  await waitFor(`${cRows}.length > 0`, 'the project tables');
  await sleep(600);

  // Captured rather than hardcoded: earlier scenarios create projects under
  // ACME, so the starting list is longer here than the sandbox fixture alone.
  const baseC = await js(cRows);
  const baseG = await js(gRows);
  const allC = baseC.join();
  const allG = baseG.join();
  const unfilteredRows = Math.max(baseC.length, baseG.length);

  check('the list starts unnarrowed',
    ['2024_Shared', '2023_LocalOnly', '2020_Zulu'].every((p) => baseC.includes(p)) &&
      ['2024_Shared', '2022_SharedOnly'].every((p) => baseG.includes(p)),
    `C=${allC} G=${allG}`);
  check('and shows no narrowing note', !(await js(noteShown)));

  await typeProject('2024');
  const yearC = await js(cRows);
  const yearG = await js(gRows);
  check('typing narrows the C drive list',
    yearC.length > 0 && yearC.length < baseC.length && yearC.every((p) => p.includes('2024')),
    yearC.join());
  check('and the G drive list',
    yearG.length > 0 && yearG.every((p) => p.includes('2024')),
    yearG.join());

  // The columns hold different projects, so this fails if one is driven off the
  // other's rows rather than each narrowing its own bucket.
  await typeProject('only');
  check('each column narrows on its own projects',
    (await js(cRows)).join() === '2023_LocalOnly' &&
      (await js(gRows)).join() === '2022_SharedOnly',
    `C=${(await js(cRows)).join()} G=${(await js(gRows)).join()}`);

  // No two-character threshold here: that guards the drive walk behind the
  // dropdown, and these rows are already in memory.
  await typeProject('z');
  check('one character is enough to narrow the tables',
    (await js(cRows)).join() === '2020_Zulu' && (await js(gRows)).length === 0,
    `C=${(await js(cRows)).join()} G=${(await js(gRows)).join()}`);
  check('the note reports the match count against the full list',
    (await js(noteShown)) &&
      new RegExp(`1 of ${unfilteredRows}\\b`).test(await js(noteText)),
    await js(noteText));

  await typeProject('qqq');
  check('a query matching nothing empties both tables',
    (await js(cRows)).length === 0 && (await js(gRows)).length === 0);
  check('and says so rather than leaving them blank and unexplained',
    /No projects match/i.test(await js(noteText)), await js(noteText));

  await js(`document.getElementById('projectQueryClear').click()`);
  await sleep(800);
  check('Clear empties the search box', (await js(`${input}.value`)) === '');
  check('and restores both lists in full',
    (await js(cRows)).join() === allC && (await js(gRows)).join() === allG,
    `C=${(await js(cRows)).join()} G=${(await js(gRows)).join()}`);
  check('and hides the note', !(await js(noteShown)));

  // The J drive list narrows the same way.
  await js(`document.getElementById('driveToggle').checked = true`);
  await js(`document.getElementById('driveToggle').dispatchEvent(new Event('change'))`);
  await sleep(1400);

  const baseJ = await js(gRows);
  check('the J drive lists its own projects',
    baseJ.includes('2021_JOnly') && baseJ.includes('2024_Shared') &&
      !baseJ.includes('2022_SharedOnly'),
    baseJ.join());

  await typeProject('jonly');
  check('and narrows to a J-only project',
    (await js(gRows)).join() === '2021_JOnly' && (await js(cRows)).length === 0,
    `C=${(await js(cRows)).join()} J=${(await js(gRows)).join()}`);

  // Leave the window as it was found -- the scenarios share one renderer.
  await js(`document.getElementById('projectQueryClear').click()`);
  await sleep(500);
  await js(`document.getElementById('driveToggle').checked = false`);
  await js(`document.getElementById('driveToggle').dispatchEvent(new Event('change'))`);
  await sleep(1000);
}

/**
 * Enter in a search box must narrow, never submit.
 *
 * index.html wraps the whole page in one <form>. The Create New Client Submit was
 * its only type="submit" button, so it was the default button -- and implicit
 * submission fires a click on it. Pressing Enter in the client or project box
 * therefore ran the client-creation handler and POSTed to the LIVE ESE API with
 * every field blank, surfacing as "Error creating client: undefined".
 *
 * This asserts on the alert text because that is the user-visible symptom, and on
 * the tables because Enter still has to do its actual job.
 */
async function enterInSearchBoxesDoesNotSubmit() {
  const cRows = `Array.from(document.querySelectorAll('#cDriveProjects tr td:first-child')).map(td => td.textContent)`;
  const projectBox = `document.getElementById('projectSearchInput')`;
  const clientBox = `document.getElementById('clientInput')`;

  // A REAL key event, not dispatchEvent.
  //
  // This matters: implicit form submission is driven by Chromium's input
  // pipeline, and a synthetic KeyboardEvent does not trigger it. A dispatchEvent
  // version of this test passes even with the bug fully reintroduced -- it only
  // exercises our own keydown handler. sendInputEvent goes through the real path.
  const pressEnter = async (selector) => {
    await js(`${selector}.focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await sleep(900);
  };

  await js(`${clientBox}.value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);
  await waitFor(`${cRows}.length > 0`, 'the project tables');
  await sleep(600);

  const before = alerts.length;

  // Enter in the project box.
  await js(`${projectBox}.value = '2020'`);
  await js(`${projectBox}.dispatchEvent(new Event('input'))`);
  await sleep(700);
  await pressEnter(projectBox);

  const afterProject = alerts.slice(before).join(' | ');
  check('Enter in the project box raises no alert',
    !/creating client/i.test(afterProject), afterProject || '(no alert)');
  check('and narrows the list instead of submitting',
    (await js(cRows)).join() === '2020_Zulu', (await js(cRows)).join());
  check('and closes the suggestions',
    (await js(`document.querySelectorAll('#projectSearchDropdown li[data-client]').length`)) === 0);

  // Enter in the client box runs the search, and still must not submit.
  await js(`document.getElementById('projectQueryClear').click()`);
  await sleep(600);
  await js(`${clientBox}.value = 'UPC'`);
  await pressEnter(clientBox);

  const afterClient = alerts.slice(before).join(' | ');
  check('Enter in the client box raises no alert',
    !/creating client/i.test(afterClient), afterClient || '(no alert)');
  check('and searches that client',
    (await js(cRows)).some((p) => p.startsWith('2026_')), (await js(cRows)).join());

  // The structural guard. Implicit submission fires a click on the form's DEFAULT
  // BUTTON -- the first type="submit" in it -- which is how a blank client got
  // POSTed. No submit button means no default button, so this is the assertion
  // that actually pins the fix, independent of any event plumbing.
  const submitButtons = await js(
    `Array.from(document.querySelectorAll(
       '#mainForm button[type="submit"], #mainForm input[type="submit"], #mainForm button:not([type])'
     )).map(b => b.id || b.textContent.trim())`
  );
  check('the page-wide form has no default submit button',
    submitButtons.length === 0,
    submitButtons.length ? `would be triggered by Enter: ${submitButtons.join(', ')}` : 'none');

  // The guard itself: the form must refuse to submit even if asked directly.
  const submitted = await js(
    `document.getElementById('mainForm')
       .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`
  );
  check('the page-wide form refuses to submit at all',
    submitted === false, `dispatchEvent returned ${submitted} (false means prevented)`);

  const afterSubmit = alerts.slice(before).join(' | ');
  check('and submitting it creates no client',
    !/creating client/i.test(afterSubmit), afterSubmit || '(no alert)');

  // Leave the window as found.
  await js(`document.getElementById('projectQueryClear').click()`);
  await sleep(400);
  await js(`${clientBox}.value = 'ACME'`);
  await js(`document.getElementById('searchButton').click()`);
  await sleep(900);
}

async function invalidProjectNameIsRejected() {
  await js(`document.getElementById('newProjectName').value = 'no-year-here'`);
  const before = alerts.length;
  await js(`document.getElementById('btnSubmit').click()`);
  await sleep(800);

  const raised = alerts.slice(before).join(' | ');
  check('an invalid project name is rejected with an alert',
    /Invalid project name format/i.test(raised), raised || '(no alert)');
  check('and nothing was created on disk',
    !exists('C', '_Clients', 'ACME', 'no-year-here'));
}

// --- runner ------------------------------------------------------------------

const SCENARIOS = [
  ['search populates both drive tables', searchPopulatesBothTables],
  ['sort reorders the tables', sortReordersTheTables],
  ['paging reveals projects in steps', pagingRevealsProjectsInSteps],
  ['a major client skips the letter bucketing', majorClientSkipsLetterBucketing],
  ['Create Folder Pairs writes valid XML', createFolderPairWritesXml],
  ['creating a project builds it from the template', createProjectBuildsFromTemplate],
  ['dated transfer folders land in the project', datedTransferFoldersLandInTheProject],
  ['the J drive path', jDriveBehaviour],
  ['project search narrows by client + project', projectSearchNarrowsByClientAndProject],
  ['project search narrows the drive tables', searchNarrowsTheDriveTables],
  ['Enter in a search box does not submit', enterInSearchBoxesDoesNotSubmit],
  ['an invalid project name is refused', invalidProjectNameIsRejected],
];

app.on('ready', () => {
  // Mirrors the app's webPreferences exactly. The renderer lives in the preload
  // now, so pointing at the app's preload is what actually loads it.
  win = new BrowserWindow({
    show: false,
    width: 1500,
    height: 1000,
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.webContents.on('preload-error', (event, preloadPath, error) => {
    console.log(`\n  FAIL  preload threw: ${error && error.message}\n`);
    app.exit(1);
  });

  win.webContents.on('did-finish-load', async () => {
    await sleep(1200);

    for (const [name, scenario] of SCENARIOS) {
      console.log(`\n  ${name}`);
      try {
        await scenario();
      } catch (error) {
        check(`${name} -- threw`, false, error.message);
      }
      for (const result of results.splice(0)) {
        console.log(
          `    ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}` +
            (result.detail && !result.ok ? `\n            got: ${result.detail}` : '')
        );
        if (!result.ok) failures += 1;
        total += 1;
      }
    }

    console.log('');
    if (failures) {
      console.log(`  ${failures} of ${total} checks failed.\n`);
      app.exit(1);
      return;
    }
    console.log(`  All ${total} behavioural checks passed.\n`);
    app.exit(0);
  });

  win.loadFile(path.join(PROJECT_ROOT, 'index.html'));
});

let failures = 0;
let total = 0;

setTimeout(() => {
  console.log('\n  FAIL  e2e timed out\n');
  app.exit(2);
}, 120000);
