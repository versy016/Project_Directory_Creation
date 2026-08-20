'use strict';

/**
 * THE ORACLE.
 *
 * Verbatim copies of the functions as they exist in script.js at tag
 * v1.1.5-prerefactor. These are the reference implementation: the tests assert
 * that src/core/ produces byte-identical output to everything in this file.
 *
 * RULES FOR THIS FILE:
 *   1. Do not tidy it. Do not fix bugs in it. Do not reformat it.
 *   2. The only permitted change from the original is turning a DOM read or a
 *      module-level mutable global into a function parameter, because a test
 *      process has neither. Every such change is marked WAS: below.
 *   3. When a Phase 2+ change intentionally alters behaviour, delete the affected
 *      oracle function in the SAME commit and replace its equality test with an
 *      explicit expected-value test. Never edit the oracle to match new output --
 *      that silently destroys the guarantee.
 *
 * Once script.js has been fully rewired to src/core/, this file is what stops a
 * later "cleanup" from quietly changing what lands on the shared drive.
 */

// --- script.js:56 -----------------------------------------------------------
// WAS: read the module-level `majorClients` global; console diagnostics removed.
function getSharedDrivePath(clientNameRaw, majorClients) {
  const clientName = (clientNameRaw || '').trim();
  if (!clientName || typeof clientName !== 'string') {
    return null;
  }

  const driveBasePath = 'G:/Shared drives';
  const clientNameUpper = clientName.toUpperCase();

  if (majorClients.includes(clientNameUpper)) {
    return driveBasePath;
  }

  const firstLetter = clientName[0].toUpperCase();
  if (firstLetter >= 'A' && firstLetter <= 'Z') {
    return `${driveBasePath}/_${firstLetter}`;
  }

  return `${driveBasePath}/_Misc`;
}

// --- script.js:744 ----------------------------------------------------------
function extractYearFromProjectName(projectName) {
  const yearMatch = projectName.match(/E?(20\d{2})/);
  return yearMatch ? parseInt(yearMatch[1], 10) : null;
}

// --- script.js:751 ----------------------------------------------------------
function sortProjects(projects) {
  return projects.sort((a, b) => {
    const yearA = extractYearFromProjectName(a);
    const yearB = extractYearFromProjectName(b);

    if (yearA !== null && yearB !== null) {
      return yearB - yearA;
    } else if (yearA !== null) {
      return -1;
    } else if (yearB !== null) {
      return 1;
    } else {
      return a.localeCompare(b);
    }
  });
}

// --- script.js:769 (inline in searchForClient) ------------------------------
function partitionProjects(cList, gList) {
  const commonProjects = cList.filter((project) => gList.includes(project));
  const uniqueCProjects = cList.filter((project) => !gList.includes(project));
  const uniqueGProjects = gList.filter((project) => !cList.includes(project));

  const sortedCommonProjects = sortProjects(commonProjects);
  const sortedUniqueCProjects = sortProjects(uniqueCProjects);
  const sortedUniqueGProjects = sortProjects(uniqueGProjects);

  return {
    common: sortedCommonProjects,
    onlyC: sortedUniqueCProjects,
    onlyG: sortedUniqueGProjects,
    combinedC: [...sortedCommonProjects, ...sortedUniqueCProjects],
    combinedG: [...sortedCommonProjects, ...sortedUniqueGProjects],
  };
}

// --- script.js:1249 (inline in the btnSubmit handler) -----------------------
function normaliseProjectName(rawValue) {
  let newProjectName = rawValue.trim();
  newProjectName = newProjectName.replace(/'/g, '');
  newProjectName = newProjectName.replace(/['"]/g, '').replace(/\s+/g, '_');
  return newProjectName;
}

// --- script.js:1255 ---------------------------------------------------------
const projectNamePattern =
  /^(E(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)\d{4}_[\w\s\/-]+|C\d{8}_[\w\s\/-]+|(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)_[\w\s\/-]+)$/;

// --- script.js:1111 ---------------------------------------------------------
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- index.html:549 ---------------------------------------------------------
function formatDateLabel(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${yyyy}_${mm}_${dd}`;
}

// --- script.js:1975 ---------------------------------------------------------
function parseExistingPairsToSet(existingXml) {
  const existingPairsSet = new Set();
  const pairRegex = /<Left>(.*?)<\/Left>\s*<Right>(.*?)<\/Right>/g;
  let match;

  while ((match = pairRegex.exec(existingXml)) !== null) {
    existingPairsSet.add(`${match[1]}|${match[2]}`);
  }

  return existingPairsSet;
}

// --- script.js:1988 ---------------------------------------------------------
// WAS: read `selectedCreationType` from the DOM and `selected_drive` from module scope.
function generateFolderPairsXml(
  clientName,
  projects,
  existingPairsSet,
  selectedCreationType,
  selected_drive
) {
  let folderPairsXml = '';
  clientName = clientName.replace(/&/g, '&amp;');

  projects.forEach((project) => {
    let leftPath;
    let rightPath;
    let differences;
    project.name = project.name.replace(/&/g, '&amp;');

    if (selectedCreationType === 'clientProject') {
      if (project.direction === 'Update Both') {
        rightPath = `${selected_drive}\\${clientName}\\${project.name}`;
        leftPath = `C:\\_Clients\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>';
      } else if (project.direction === 'Update Right') {
        leftPath = `C:\\_Clients\\${clientName}\\${project.name}`;
        rightPath = `${selected_drive}\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
      } else if (project.direction === 'Update Left') {
        leftPath = `${selected_drive}\\${clientName}\\${project.name}`;
        rightPath = `C:\\_Clients\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
      }
    } else if (selectedCreationType === 'quoteDirectory') {
      if (project.direction === 'Update Both') {
        leftPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        rightPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>';
      } else if (project.direction === 'Update Right') {
        leftPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        rightPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
      } else if (project.direction === 'Update Left') {
        leftPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        rightPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
        differences =
          '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
      }
    }

    if (
      (selected_drive === 'G:\\Shared drives\\ES Cloud\\_Clients' &&
        (leftPath.includes('J:') || rightPath.includes('J:'))) ||
      (selected_drive === 'J:\\__Clients' &&
        (leftPath.includes('G:') || rightPath.includes('G:')))
    ) {
      return; // Skip this iteration
    }

    const pairIdentifier = `${leftPath}|${rightPath}`;
    if (!existingPairsSet.has(pairIdentifier)) {
      folderPairsXml += `
            <Pair>
                <Left>${leftPath}</Left>
                <Right>${rightPath}</Right>
                <Synchronize>
                    ${differences}
                    <DeletionPolicy>RecycleBin</DeletionPolicy>
                    <VersioningFolder Style="Replace"/>
                </Synchronize>
            </Pair>\n`;
    }
  });

  return folderPairsXml;
}

// --- script.js:2072 ---------------------------------------------------------
function appendFolderPairsToExistingXml(existingXml, newFolderPairsXml) {
  const folderPairsStartIndex = existingXml.indexOf('<FolderPairs>');
  const folderPairsEndIndex = existingXml.indexOf('</FolderPairs>', folderPairsStartIndex);

  if (folderPairsStartIndex !== -1 && folderPairsEndIndex !== -1) {
    return (
      existingXml.substring(0, folderPairsEndIndex) +
      newFolderPairsXml +
      existingXml.substring(folderPairsEndIndex)
    );
  } else {
    return existingXml;
  }
}

module.exports = {
  getSharedDrivePath,
  extractYearFromProjectName,
  sortProjects,
  partitionProjects,
  normaliseProjectName,
  projectNamePattern,
  formatBytes,
  formatDateLabel,
  parseExistingPairsToSet,
  generateFolderPairsXml,
  appendFolderPairsToExistingXml,
};
