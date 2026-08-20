'use strict';

const { parseStringPromise } = require('xml2js');
const { roots } = require('../config/roots');
const { CLIENT_PROJECT, QUOTE_DIRECTORY } = require('./paths');

/**
 * Reading, generating and merging FreeFileSync .ffs_gui configuration.
 * Pure: no fs, no DOM. Callers supply the XML string and receive one back.
 *
 * Ported from script.js:1975-2086 and script.js:1592-1632.
 */

const DIFFERENCES_TWO_WAY =
  '<Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>';
const DIFFERENCES_ONE_WAY =
  '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';

const DIRECTION_BOTH = 'Update Both';
const DIRECTION_RIGHT = 'Update Right';
const DIRECTION_LEFT = 'Update Left';

/**
 * Serialise one <Pair>. Written as explicit concatenation rather than a template
 * literal so the emitted whitespace is fixed by this function, not by however
 * this file happens to be indented. The output is byte-identical to script.js:2043.
 */
function renderPair(leftPath, rightPath, differences) {
  return (
    '\n' +
    '            <Pair>\n' +
    '                <Left>' + leftPath + '</Left>\n' +
    '                <Right>' + rightPath + '</Right>\n' +
    '                <Synchronize>\n' +
    '                    ' + differences + '\n' +
    '                    <DeletionPolicy>RecycleBin</DeletionPolicy>\n' +
    '                    <VersioningFolder Style="Replace"/>\n' +
    '                </Synchronize>\n' +
    '            </Pair>\n'
  );
}

/**
 * Index the pairs already present in a config so we never write a duplicate.
 * Regex-based, exactly as the original -- it relies on <Left> and <Right> being
 * adjacent, which is true of both our own output and FreeFileSync's.
 *
 * @returns {Set<string>} entries shaped `left|right`
 */
function parseExistingPairsToSet(existingXml) {
  const existingPairsSet = new Set();
  const pairRegex = /<Left>(.*?)<\/Left>\s*<Right>(.*?)<\/Right>/g;
  let match;

  while ((match = pairRegex.exec(existingXml || '')) !== null) {
    existingPairsSet.add(`${match[1]}|${match[2]}`);
  }

  return existingPairsSet;
}

/**
 * Resolve the left/right pair of paths for one project in one sync direction.
 *
 * QUIRK (preserved): paths are built with template literals, NOT path.join, so
 * `selectedDrive` keeps its forward slashes and the result has mixed separators
 * (`G:/Shared drives/_A\CLIENT\PROJECT`). FreeFileSync tolerates this; the app's
 * own `includes('G:\\')` checks do not. Do not "fix" without a paired test.
 *
 * An unrecognised direction returns undefined paths. That used to be reachable
 * from the UI -- the new-project dropdown emitted "Update LEft" (capital E),
 * which matched no branch and wrote a <Pair> containing the literal text
 * "undefined" into the real SyncSettings.ffs_gui. The typo is fixed, and
 * generateFolderPairsXml now skips an unrecognised direction with an error
 * rather than writing it, so a bad value cannot reach a config file again.
 */
function resolvePairPaths({ creationType, direction, clientName, projectName, selectedDrive }) {
  const suffix = `${clientName}\\${projectName}`;

  if (creationType === CLIENT_PROJECT) {
    const local = `${roots.localClients}\\${suffix}`;
    const shared = `${selectedDrive}\\${suffix}`;

    if (direction === DIRECTION_BOTH) {
      return { leftPath: local, rightPath: shared, differences: DIFFERENCES_TWO_WAY };
    }
    if (direction === DIRECTION_RIGHT) {
      return { leftPath: local, rightPath: shared, differences: DIFFERENCES_ONE_WAY };
    }
    if (direction === DIRECTION_LEFT) {
      return { leftPath: shared, rightPath: local, differences: DIFFERENCES_ONE_WAY };
    }
    return { leftPath: undefined, rightPath: undefined, differences: undefined };
  }

  if (creationType === QUOTE_DIRECTORY) {
    const local = `${roots.localAccounts}\\${suffix}`;
    const shared = `${roots.sharedQuotes}\\${suffix}`;

    if (direction === DIRECTION_BOTH) {
      return { leftPath: shared, rightPath: local, differences: DIFFERENCES_TWO_WAY };
    }
    if (direction === DIRECTION_RIGHT) {
      return { leftPath: local, rightPath: shared, differences: DIFFERENCES_ONE_WAY };
    }
    if (direction === DIRECTION_LEFT) {
      return { leftPath: shared, rightPath: local, differences: DIFFERENCES_ONE_WAY };
    }
    return { leftPath: undefined, rightPath: undefined, differences: undefined };
  }

  return { leftPath: undefined, rightPath: undefined, differences: undefined };
}

/**
 * Drop pairs that belong to the other shared drive.
 * Port of script.js:2033.
 *
 * DEAD BRANCH (preserved): the first condition compares selectedDrive against a
 * backslash literal that getSharedDrivePath can never produce -- it returns
 * forward-slash paths (see the roots note in README.md). So J: pairs are never
 * actually filtered out of the G: config today. Frozen by test, so that changing
 * it is a deliberate, reviewable diff rather than an accident.
 */
function shouldSkipPair(selectedDrive, leftPath, rightPath) {
  if (
    selectedDrive === roots.legacySharedClients &&
    (leftPath.includes('J:') || rightPath.includes('J:'))
  ) {
    return true;
  }
  if (
    selectedDrive === roots.jDriveClients &&
    (leftPath.includes('G:') || rightPath.includes('G:'))
  ) {
    return true;
  }
  return false;
}

/**
 * Build the <Pair> fragments for a set of projects, skipping any already present.
 *
 * Deliberate deviation: the original reassigns `project.name` in place while
 * escaping ampersands. Every caller builds the array fresh, so nothing observes
 * that write -- this version leaves the input untouched.
 *
 * @param {object}   args
 * @param {string}   args.clientName
 * @param {Array<{name: string, direction: string}>} args.projects
 * @param {Set<string>} args.existingPairsSet
 * @param {'clientProject'|'quoteDirectory'} args.creationType
 * @param {string}   args.selectedDrive
 * @returns {string} concatenated <Pair> XML, '' when there is nothing to add
 */
function generateFolderPairsXml({
  clientName,
  projects,
  existingPairsSet,
  creationType,
  selectedDrive,
}) {
  const escapedClientName = String(clientName).replace(/&/g, '&amp;');
  let folderPairsXml = '';

  projects.forEach((project) => {
    const escapedProjectName = String(project.name).replace(/&/g, '&amp;');

    const { leftPath, rightPath, differences } = resolvePairPaths({
      creationType,
      direction: project.direction,
      clientName: escapedClientName,
      projectName: escapedProjectName,
      selectedDrive,
    });

    // An unrecognised direction resolves to nothing. This used to fall straight
    // through and write a <Pair> containing the literal text "undefined" into the
    // user's real config -- silently, on the common G-drive path. Whatever the
    // source of the bad value, no pair is better than a corrupt one.
    if (!leftPath || !rightPath || !differences) {
      console.error(
        `Skipping "${project.name}": unrecognised sync direction ` +
          `${JSON.stringify(project.direction)}`
      );
      return;
    }

    if (shouldSkipPair(selectedDrive, leftPath, rightPath)) {
      return;
    }

    const pairIdentifier = `${leftPath}|${rightPath}`;
    if (!existingPairsSet.has(pairIdentifier)) {
      folderPairsXml += renderPair(leftPath, rightPath, differences);
    }
  });

  return folderPairsXml;
}

/**
 * Splice new pairs in just before </FolderPairs>, leaving the rest of the user's
 * config (filters, comparison variant, email settings) untouched.
 * Port of script.js:2072.
 */
function appendFolderPairsToExistingXml(existingXml, newFolderPairsXml) {
  const folderPairsStartIndex = existingXml.indexOf('<FolderPairs>');
  const folderPairsEndIndex = existingXml.indexOf('</FolderPairs>', folderPairsStartIndex);

  if (folderPairsStartIndex !== -1 && folderPairsEndIndex !== -1) {
    return (
      existingXml.substring(0, folderPairsEndIndex) +
      newFolderPairsXml +
      existingXml.substring(folderPairsEndIndex)
    );
  }

  return existingXml;
}

/**
 * BUG FIX (not a port -- this function did not exist).
 *
 * script.js:1422 and script.js:2330 both call createFullXmlConfig() as the
 * fallback for "the .ffs_gui file is missing", but it was never defined, so that
 * path threw ReferenceError -- precisely in the situation it was meant to handle.
 *
 * The skeleton below matches the shipped SyncSettings.ffs_gui (XmlFormat 23) so a
 * generated file opens in FreeFileSync identically to a hand-made one.
 */
function createFullXmlConfig(folderPairsXml) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<FreeFileSync XmlType="GUI" XmlFormat="23">\n' +
    '    <Notes/>\n' +
    '    <Compare>\n' +
    '        <Variant>TimeAndSize</Variant>\n' +
    '        <Symlinks>Exclude</Symlinks>\n' +
    '        <IgnoreTimeShift/>\n' +
    '    </Compare>\n' +
    '    <Synchronize>\n' +
    '        <Changes>\n' +
    '            <Left Create="right" Update="right" Delete="right"/>\n' +
    '            <Right Create="left" Update="left" Delete="left"/>\n' +
    '        </Changes>\n' +
    '        <DeletionPolicy>RecycleBin</DeletionPolicy>\n' +
    '        <VersioningFolder Style="Replace"/>\n' +
    '    </Synchronize>\n' +
    '    <Filter>\n' +
    '        <Include>\n' +
    '            <Item>*</Item>\n' +
    '        </Include>\n' +
    '        <Exclude>\n' +
    '            <Item>\\System Volume Information\\</Item>\n' +
    '            <Item>\\$Recycle.Bin\\</Item>\n' +
    '            <Item>\\RECYCLE?\\</Item>\n' +
    '            <Item>\\Recovery\\</Item>\n' +
    '            <Item>*\\thumbs.db</Item>\n' +
    '        </Exclude>\n' +
    '        <SizeMin Unit="None">0</SizeMin>\n' +
    '        <SizeMax Unit="None">0</SizeMax>\n' +
    '        <TimeSpan Type="None">0</TimeSpan>\n' +
    '    </Filter>\n' +
    '    <FolderPairs>\n' +
    (folderPairsXml || '') +
    '    </FolderPairs>\n' +
    '    <Errors Ignore="false" Retry="0" Delay="5"/>\n' +
    '    <PostSyncCommand Condition="Completion"/>\n' +
    '    <LogFolder/>\n' +
    '    <EmailNotification Condition="Always"/>\n' +
    '    <GridViewType>Action</GridViewType>\n' +
    '</FreeFileSync>\n'
  );
}

/**
 * Read the pairs out of an existing config so the UI can show which projects are
 * already synced, and in which direction.
 * Port of script.js:1592 readAndProcessXmlConfig().
 *
 * QUIRK (preserved): `gDriveProject` is derived with `left.includes('G:\\')`,
 * which never matches the forward-slash paths this app writes, and never matches
 * J: pairs at all. The UI only uses these values for a substring test against the
 * project name, so the mislabelling is currently invisible.
 *
 * @returns {Promise<Array<{cDriveProject: string, gDriveProject: string, variantSymbol: string}>>}
 */
async function parseFolderPairs(xmlContent) {
  if (!xmlContent) {
    return [];
  }

  try {
    const result = await parseStringPromise(xmlContent);
    const folderPairs = result.FreeFileSync.FolderPairs[0].Pair;

    const parsed = [];

    for (const pair of folderPairs) {
      try {
        const left = pair.Left[0];
        const right = pair.Right[0];
        const differences = pair.Synchronize[0].Differences[0].$;

        let variantSymbol = '';
        if (differences.RightNewer === 'left' && differences.RightOnly === 'left') {
          variantSymbol = '<>';
        } else if (differences.RightNewer === 'none' && differences.RightOnly === 'none') {
          variantSymbol = left.includes('C:\\') ? '>' : '<';
        }

        parsed.push({
          cDriveProject: left.includes('C:\\') ? left : right,
          gDriveProject: left.includes('G:\\') ? left : right,
          variantSymbol,
        });
      } catch (pairError) {
        // One unreadable pair must not hide all the others.
        //
        // This was a single try/catch around the whole map. A pair in
        // FreeFileSync's <Changes> form -- what "use database file to detect
        // changes" produces -- has no <Differences> element, threw here, and took
        // every other pair down with it. The app then showed NO project as synced
        // when only one pair had been altered. src/core/ffs-repair converts those
        // back; this makes sure a single bad pair can never blank the list again.
        console.error('Skipping unreadable folder pair:', pairError.message);
      }
    }

    return parsed;
  } catch (error) {
    // An empty <FolderPairs/> leaves `Pair` undefined, so the caller gets [].
    return [];
  }
}

module.exports = {
  DIFFERENCES_TWO_WAY,
  DIFFERENCES_ONE_WAY,
  DIRECTION_BOTH,
  DIRECTION_RIGHT,
  DIRECTION_LEFT,
  renderPair,
  parseExistingPairsToSet,
  resolvePairPaths,
  shouldSkipPair,
  generateFolderPairsXml,
  appendFolderPairsToExistingXml,
  createFullXmlConfig,
  parseFolderPairs,
};
