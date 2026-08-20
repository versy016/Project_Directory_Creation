#!/usr/bin/env node
'use strict';

/**
 * Artifact verification -- run AFTER a build, BEFORE publishing.
 *
 *   npm run dist
 *   npm run verify:build
 *
 * The config guards in tests/release/packaging.test.js check what package.json
 * *says*. This checks what electron-builder actually *did*, by opening the real
 * app.asar. Those two can disagree: a glob that looks right can still fail to
 * match, and the failure is invisible until an installed copy crashes.
 *
 * Exit code 0 = safe to publish. Non-zero = do not publish.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');
const ASAR = path.join(UNPACKED, 'resources', 'app.asar');

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function ok(message) {
  notes.push(message);
}

// --- the build must exist and be current ------------------------------------

if (!fs.existsSync(ASAR)) {
  console.error(`\n  No build found at ${ASAR}`);
  console.error('  Run `npm run dist` first.\n');
  process.exit(1);
}

const asarMtime = fs.statSync(ASAR).mtimeMs;

/** Every source file that ends up inside the package, so nothing is missed. */
function collectSources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = [
  ...['main.js', 'index.html', 'preload.js', 'style.css', 'package.json']
    .map((f) => path.join(ROOT, f))
    .filter((f) => fs.existsSync(f)),
  ...['SyncSettings.ffs_gui', 'SyncSettings_Quotes.ffs_gui', 'SyncSettingsJdrive.ffs_gui']
    .map((f) => path.join(ROOT, f))
    .filter((f) => fs.existsSync(f)),
  ...(fs.existsSync(path.join(ROOT, 'src')) ? collectSources(path.join(ROOT, 'src')) : []),
];

const staleSources = sourceFiles
  .filter((file) => fs.statSync(file).mtimeMs > asarMtime)
  .map((file) => path.relative(ROOT, file));

if (staleSources.length) {
  fail(
    `build predates ${staleSources.length} source file(s), so it does not contain ` +
      `your latest changes:\n` +
      staleSources
        .slice(0, 10)
        .map((f) => `        ${f}`)
        .join('\n') +
      (staleSources.length > 10 ? `\n        ...and ${staleSources.length - 10} more` : '')
  );
} else {
  const ageHours = (Date.now() - asarMtime) / 3600000;
  if (ageHours > 24) {
    fail(
      `build is ${Math.round(ageHours / 24)} day(s) old -- rebuild rather than ` +
        `publishing a stale artifact`
    );
  } else {
    ok(`build is current (${Math.round(ageHours * 60)} min old, newer than all ${sourceFiles.length} sources)`);
  }
}

// --- what actually made it into the package ---------------------------------

let contents;
try {
  contents = require('@electron/asar').listPackage(ASAR);
} catch (error) {
  console.error('\n  Could not read app.asar. Install the tool with:');
  console.error('    npm i -D @electron/asar\n');
  console.error(`  (${error.message})\n`);
  process.exit(1);
}

const packaged = new Set(contents.map((entry) => entry.replace(/\\/g, '/').replace(/^\//, '')));

const MUST_SHIP = [
  'main.js',
  'index.html',
  'preload.js',
  'style.css',
  'config.json',
  'src/config/roots.js',
  'src/core/paths.js',
  'src/core/project-name.js',
  'src/core/sorting.js',
  'src/core/ffs-config.js',
  'src/core/format.js',
  'src/core/project-index.js',
  'src/core/project-filter.js',
  'src/renderer/state.js',
  'src/renderer/project-search.js',
  'src/renderer/project-filters.js',
  'src/renderer/update-banner.js',
  'src/renderer/sync-controls.js',
  'src/renderer/project-tables.js',
  'src/renderer/new-client-form.js',
  'src/renderer/major-clients.js',
  'src/renderer/client-search.js',
  'src/renderer/new-project-form.js',
  'src/main/google-drive.js',
  'src/main/drive-status-window.js',
  'src/main/drive-status-preload.js',
  'src/main/alert-modal.js',
  'src/core/ffs-repair.js',
  'src/core/ffs-paths.js',
  'src/services/ffs-repair-service.js',
  'src/services/fs-repo.js',
  'src/services/algolia.js',
  'src/services/project-service.js',
  'src/services/ese-api.js',
];

const MUST_NOT_SHIP = ['tests', 'docs', 'scripts'];

for (const file of MUST_SHIP) {
  if (packaged.has(file)) {
    ok(`packaged: ${file}`);
  } else {
    fail(`MISSING from app.asar: ${file} -- the installed app will crash on require`);
  }
}

for (const dir of MUST_NOT_SHIP) {
  const leaked = [...packaged].filter((entry) => entry === dir || entry.startsWith(`${dir}/`));
  if (leaked.length) {
    fail(`${leaked.length} dev file(s) leaked into the package from ${dir}/`);
  } else {
    ok(`excluded: ${dir}/`);
  }
}

// --- the update manifest ----------------------------------------------------

const updateYml = path.join(UNPACKED, 'resources', 'app-update.yml');
if (!fs.existsSync(updateYml)) {
  fail('resources/app-update.yml is missing -- the installed app cannot check for updates');
} else {
  const yml = fs.readFileSync(updateYml, 'utf-8');
  if (!/provider:\s*github/.test(yml)) {
    fail('app-update.yml does not name the github provider');
  } else {
    ok('app-update.yml present and points at github');
  }
}

// --- installer artifacts match the declared version -------------------------

const distFiles = fs.readdirSync(path.join(ROOT, 'dist'));
const installer = distFiles.find((f) => f.endsWith('.exe') && f.includes(pkg.version));

if (!installer) {
  fail(
    `no installer in dist/ for version ${pkg.version} ` +
      `(found: ${distFiles.filter((f) => f.endsWith('.exe')).join(', ') || 'none'})`
  );
} else {
  ok(`installer built for declared version: ${installer}`);
}

const latestYml = path.join(ROOT, 'dist', 'latest.yml');
if (fs.existsSync(latestYml)) {
  const declared = /version:\s*(\S+)/.exec(fs.readFileSync(latestYml, 'utf-8'));
  if (declared && declared[1] !== pkg.version) {
    fail(`dist/latest.yml advertises ${declared[1]} but package.json says ${pkg.version}`);
  } else if (declared) {
    ok(`latest.yml advertises ${declared[1]}`);
  }
}

// --- report -----------------------------------------------------------------

console.log('');
for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const problem of problems) {
  console.log(`  FAIL  ${problem}`);
}
console.log('');

if (problems.length) {
  console.log(`  ${problems.length} problem(s). DO NOT PUBLISH.\n`);
  process.exit(1);
}

console.log(`  Build verified: ${pkg.version}. Safe to publish.\n`);
