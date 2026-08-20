'use strict';

/**
 * Project / quote name rules. Pure: no fs, no DOM.
 * Ported verbatim from script.js:1249-1272 and script.js:744.
 */

/**
 * Accepted shapes, all requiring a trailing `_<something>`:
 *   E<year><4 digits>_Name   e.g. E20240123_Roadworks   (tender reference)
 *   C<8 digits>_Name         e.g. C12345678_Roadworks   (client reference)
 *   <year>_Name              e.g. 2024_Roadworks        (manual entry)
 * where <year> is 2010-2050.
 */
const PROJECT_NAME_PATTERN =
  /^(E(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)\d{4}_[\w\s\/-]+|C\d{8}_[\w\s\/-]+|(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)_[\w\s\/-]+)$/;

/**
 * Clean a raw name from the form into the name used on disk.
 *
 * The original applies the quote-stripping twice (script.js:1250 strips single
 * quotes, then 1252 strips both single and double). The duplication is harmless
 * and preserved here only in effect, not in shape.
 */
function normaliseProjectName(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .replace(/['"]/g, '')
    .replace(/\s+/g, '_');
}

function isValidProjectName(name) {
  return PROJECT_NAME_PATTERN.test(String(name == null ? '' : name).trim());
}

/**
 * Port of script.js:744 extractYearFromProjectName().
 *
 * QUIRK (preserved): the regex is unanchored and `E?` is optional, so this finds
 * the first `20xx` anywhere in the string -- including inside a client code or a
 * date suffix, not just a leading year prefix.
 *
 * @returns {number|null}
 */
function extractYearFromProjectName(projectName) {
  const yearMatch = String(projectName == null ? '' : projectName).match(/E?(20\d{2})/);
  return yearMatch ? parseInt(yearMatch[1], 10) : null;
}

module.exports = {
  PROJECT_NAME_PATTERN,
  normaliseProjectName,
  isValidProjectName,
  extractYearFromProjectName,
};
