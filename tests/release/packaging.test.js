'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

/**
 * Release-configuration guards.
 *
 * These exist because a packaging mistake is invisible until users have already
 * been shipped a broken build -- `npm test` passes, the app runs fine from source,
 * and only the installed copy is broken. The specific bug that prompted this file:
 * `"!src/"` sat in build.files, so the entire new src/ tree would have been
 * silently omitted from the installer while working perfectly in development.
 */

/**
 * Minimal glob matcher covering the pattern vocabulary actually used in
 * build.files (`**`, `*`, bare directory names). Not a full minimatch -- the
 * authoritative check is scripts/verify-build.js, which inspects real output.
 */
function globToRegExp(glob) {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*\*\//g, '@@SLASH@@');
  re = re.replace(/\*\*/g, '@@DOUBLE@@');
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/@@SLASH@@/g, '(?:.*/)?');
  re = re.replace(/@@DOUBLE@@/g, '.*');
  re = re.replace(/\?/g, '.');
  return new RegExp(`^${re}$`);
}

function isExcluded(filePath) {
  return pkg.build.files
    .filter((pattern) => pattern.startsWith('!'))
    .some((pattern) => {
      const bare = pattern.slice(1).replace(/\/$/, '');
      return globToRegExp(bare).test(filePath) || globToRegExp(`${bare}/**`).test(filePath);
    });
}

test('runtime code is included in the package', async (t) => {
  const mustShip = [
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

  for (const file of mustShip) {
    await t.test(`${file} is not excluded by build.files`, () => {
      assert.equal(
        isExcluded(file),
        false,
        `${file} would be omitted from the installer -- the app would work in ` +
          `development and crash once installed`
      );
    });
  }
});

test('development-only files are excluded from the package', async (t) => {
  const mustNotShip = [
    'tests/core/paths.test.js',
    'tests/legacy/legacy-implementations.js',
    'README.md',
    'scripts/verify-build.js',
  ];

  for (const file of mustNotShip) {
    await t.test(`${file} is excluded`, () => {
      assert.equal(isExcluded(file), true);
    });
  }
});

test('every file the app requires at runtime actually exists on disk', () => {
  const referenced = [
    pkg.main,
    'index.html',
    'preload.js',
    'style.css',
    'SyncSettings.ffs_gui',
    'SyncSettings_Quotes.ffs_gui',
    'SyncSettingsJdrive.ffs_gui',
    'app-update.yml',
    'pdc.ico',
  ];

  for (const file of referenced) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing: ${file}`);
  }
});

test('every extraFiles entry points at a file that exists', () => {
  for (const entry of pkg.build.extraFiles) {
    const from = typeof entry === 'string' ? entry : entry.from;
    assert.ok(fs.existsSync(path.join(ROOT, from)), `extraFiles missing: ${from}`);
  }
});

/**
 * Publishing guards. `--publish always` uploads to GitHub; combined with
 * autoInstallOnAppQuit in main.js that is a direct line to every installed copy.
 * Only one script is allowed to do it, and only into a draft release.
 */
test('publishing is deliberate, not a side effect of building', async (t) => {
  await t.test('build.publish is inside build (root-level "publish" is ignored)', () => {
    assert.ok(pkg.build.publish, 'build.publish is missing');
    assert.equal(pkg.publish, undefined, 'a root-level "publish" key is silently ignored');
  });

  await t.test('releaseType is draft, so a publish never reaches users directly', () => {
    assert.equal(pkg.build.publish.releaseType, 'draft');
  });

  await t.test('only release:draft may publish', () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name === 'release:draft') {
        assert.ok(script.includes('--publish always'));
        continue;
      }
      assert.ok(
        !script.includes('--publish always'),
        `script "${name}" can publish to users: ${script}`
      );
    }
  });

  await t.test('every electron-builder script states its publish policy explicitly', () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (!script.includes('electron-builder')) continue;
      assert.ok(
        script.includes('--publish'),
        `script "${name}" leaves publishing to electron-builder's default`
      );
    }
  });

  await t.test('building runs the test suite first', () => {
    for (const name of ['dist', 'release:draft']) {
      assert.ok(pkg.scripts[name].includes('npm run verify'), `${name} skips verification`);
    }
  });
});

/**
 * The version is written in two places. If they drift, the About line lies about
 * which build the user is running -- which makes every bug report ambiguous.
 */
test('the version shown in the UI matches package.json', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  const match = html.match(/Version\s+(\d+\.\d+\.\d+)/);

  assert.ok(match, 'no "Version x.y.z" string found in index.html');
  assert.equal(
    match[1],
    pkg.version,
    `index.html says ${match[1]} but package.json says ${pkg.version} -- bump both`
  );
});

test('the Google Maps key file stays out of git', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8');
  assert.ok(
    gitignore.split(/\r?\n/).includes('config.json'),
    'config.json holds the Maps API key and must remain gitignored'
  );
});
