'use strict';

/**
 * Publish the draft GitHub release for the version in package.json.
 *
 * WHY THIS EXISTS
 * ---------------
 * `release:draft` uploads a draft; something then has to flip it to published.
 * Doing that on github.com means leaving the terminal, and the friction was being
 * mistaken for the safety mechanism. It is not. The safety mechanism is that
 * publishing is a SEPARATE, DELIBERATE STEP from building -- and that survives
 * perfectly well as a second command.
 *
 * So this replaces "open the browser and eyeball the page" with checks a browser
 * cannot do: that the draft matches this working tree's version and tag, that all
 * three auto-update assets actually finished uploading, and that you are not about
 * to publish over an existing release. It refuses rather than guesses.
 *
 * WHAT THIS DOES TO USERS
 * -----------------------
 * Publishing is the irreversible step. main.js downloads an available update
 * immediately and installs it on quit, so a published release reaches every
 * workstation without anyone agreeing to it, and electron-updater will not move a
 * user backwards afterwards. Recovery is to publish a HIGHER version.
 *
 * That is why this asks you to type the version to confirm, and why it fails
 * closed when there is no terminal to ask in. Pass --yes only from somewhere that
 * has already made the decision deliberately.
 *
 *   node scripts/publish-release.js              interactive confirm
 *   node scripts/publish-release.js --dry-run    run every check, publish nothing
 *   node scripts/publish-release.js --yes        skip the prompt (CI)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ASSUME_YES = args.includes('--yes');

const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const PRODUCT = pkg.build.productName;
const { owner, repo } = pkg.build.publish;

let failed = false;

const ok = (msg) => console.log(`  ok    ${msg}`);
const info = (msg) => console.log(`        ${msg}`);
function fail(msg) {
  console.log(`  FAIL  ${msg}`);
  failed = true;
}

function die(msg) {
  console.log(`\n  ${msg}\n`);
  process.exit(1);
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

async function api(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${PRODUCT}-release-script`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const detail = body && body.message ? body.message : response.statusText;
    die(`GitHub API ${response.status} on ${pathname}: ${detail}`);
  }

  return body;
}

/** Type the version back, so a muscle-memory Enter cannot publish. */
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(`\n  Publishing ${PRODUCT} ${VERSION} (${owner}/${repo})\n`);

  if (!token) {
    die('No GH_TOKEN or GITHUB_TOKEN in the environment -- cannot reach GitHub.');
  }

  // --- find the draft -------------------------------------------------------

  const releases = await api(`/repos/${owner}/${repo}/releases?per_page=100`);
  const matching = releases.filter((release) => release.tag_name === TAG);

  if (matching.length === 0) {
    die(
      `No release found for ${TAG}. Run "npm run release:draft" first, ` +
        `and check the version in package.json.`
    );
  }

  if (matching.length > 1) {
    die(`${matching.length} releases share the tag ${TAG}. Resolve that on GitHub first.`);
  }

  const release = matching[0];

  if (!release.draft) {
    die(
      `${TAG} is already published (${release.html_url}).\n` +
        `  There is no way to un-ship it -- to correct a bad release, bump the\n` +
        `  version and publish a higher one.`
    );
  }

  ok(`found draft ${TAG}`);

  // --- the assets auto-update needs ----------------------------------------

  const required = [
    `${PRODUCT} Setup ${VERSION}.exe`,
    `${PRODUCT} Setup ${VERSION}.exe.blockmap`,
    'latest.yml',
  ];

  const uploaded = new Map(release.assets.map((asset) => [asset.name, asset]));

  for (const name of required) {
    const asset = uploaded.get(name);
    if (!asset) {
      fail(`missing asset: ${name} -- clients cannot update without it`);
    } else if (asset.state !== 'uploaded') {
      fail(`asset ${name} is in state "${asset.state}", not "uploaded"`);
    } else {
      ok(`asset present: ${name}`);
    }
  }

  // Not required by the updater, but it is the rollback copy.
  const portable = `${PRODUCT}-${VERSION}-win.exe`;
  if (uploaded.has(portable)) {
    ok(`asset present: ${portable}`);
  } else {
    info(`note: ${portable} is not attached -- no portable build to fall back on`);
  }

  // A stale asset from an earlier build of the same version is worth knowing about.
  const unexpected = [...uploaded.keys()].filter(
    (name) => !required.includes(name) && name !== portable
  );
  if (unexpected.length) {
    info(`note: also attached -- ${unexpected.join(', ')}`);
  }

  if (failed) {
    die('Draft is incomplete. Nothing published.');
  }

  // --- confirm --------------------------------------------------------------

  console.log(`\n  ${release.html_url}`);
  console.log(
    `\n  Publishing sends ${VERSION} to EVERY installed copy. They download it\n` +
      `  immediately and install it on quit. This cannot be undone.\n`
  );

  if (DRY_RUN) {
    console.log('  --dry-run: all checks passed, nothing published.\n');
    return;
  }

  if (!ASSUME_YES) {
    if (!process.stdin.isTTY) {
      die('Not a terminal, so there is nobody to confirm with. Re-run with --yes if you mean it.');
    }

    const answer = await confirm(`  Type ${VERSION} to publish (anything else aborts): `);
    if (answer !== VERSION) {
      die('Aborted. Nothing published.');
    }
  }

  // --- publish --------------------------------------------------------------

  const published = await api(`/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ draft: false, make_latest: 'true' }),
  });

  console.log(`\n  Published: ${published.html_url}`);
  console.log('  Users will pick it up on their next launch and install it on quit.\n');
}

main().catch((error) => {
  die(`Unexpected failure: ${error && error.stack ? error.stack : error}`);
});
