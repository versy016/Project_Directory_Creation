'use strict';

const { extractYearFromProjectName } = require('./project-name');

/**
 * Ordering and set-partitioning for the two project tables. Pure: no fs, no DOM.
 * Ported from script.js:751-779.
 */

/**
 * Newest year first; named-but-undated projects sink below dated ones and sort
 * alphabetically among themselves.
 *
 * Deliberate deviation: the original sorts the caller's array in place. Every
 * current caller passes a freshly `.filter()`ed array and never reads it again,
 * so the mutation is unobservable -- returning a copy is behaviour-identical and
 * removes a footgun.
 */
function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const yearA = extractYearFromProjectName(a);
    const yearB = extractYearFromProjectName(b);

    if (yearA !== null && yearB !== null) {
      return yearB - yearA;
    }
    if (yearA !== null) {
      return -1;
    }
    if (yearB !== null) {
      return 1;
    }
    return a.localeCompare(b);
  });
}

/**
 * Split the two directory listings into the three buckets the UI renders:
 * synced on both drives, local only, shared only.
 *
 * `combinedC` / `combinedG` are what actually feed the tables: common projects
 * first (so the two columns line up row-for-row), then that drive's exclusives.
 */
function partitionProjects(cProjects, gProjects) {
  const common = cProjects.filter((project) => gProjects.includes(project));
  const onlyC = cProjects.filter((project) => !gProjects.includes(project));
  const onlyG = gProjects.filter((project) => !cProjects.includes(project));

  const sortedCommon = sortProjects(common);
  const sortedOnlyC = sortProjects(onlyC);
  const sortedOnlyG = sortProjects(onlyG);

  return {
    common: sortedCommon,
    onlyC: sortedOnlyC,
    onlyG: sortedOnlyG,
    combinedC: [...sortedCommon, ...sortedOnlyC],
    combinedG: [...sortedCommon, ...sortedOnlyG],
  };
}

module.exports = { sortProjects, partitionProjects };
