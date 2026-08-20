'use strict';

/**
 * Display formatting. Pure: no fs, no DOM.
 */

/**
 * Port of script.js:1111 formatBytes().
 *
 * QUIRK (preserved): negative byte counts produce NaN, and anything above YB
 * indexes past the end of the table and yields "undefined". Neither is reachable
 * from the current UI, which only ever passes a directory size.
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Port of updateDateLabel() in index.html:549.
 *
 * Produces the `YYYY_MM_DD` label used both as the on-screen hint and as the
 * literal folder name created under TransIn / TransOut, so its exact shape is
 * load-bearing on disk -- not cosmetic.
 */
function formatDateLabel(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${yyyy}_${mm}_${dd}`;
}

module.exports = { formatBytes, formatDateLabel };
