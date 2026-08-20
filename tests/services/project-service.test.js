'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point every root at a throwaway tree BEFORE anything reads config/roots.
// node --test runs each file in its own process, so this cannot leak.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'pdc-svc-'));

process.env.PDC_LOCAL_ROOT = path.join(SANDBOX, 'C', '_Clients');
process.env.PDC_ACCTS_ROOT = path.join(SANDBOX, 'C', '__Accounts', '__Clients');
process.env.PDC_SHARED_ROOT = path.join(SANDBOX, 'G');
process.env.PDC_SHARED_QUOTES_ROOT = path.join(SANDBOX, 'G', 'quotes');
process.env.PDC_PROJECT_TEMPLATES = path.join(SANDBOX, 'G', 'templates');
process.env.PDC_FFS_DIR = path.join(SANDBOX, 'ffs');

const test = require('node:test');
const assert = require('node:assert/strict');

const { createProject } = require('../../src/services/project-service');

const TEMPLATE = path.join(SANDBOX, 'G', 'templates', '_Standard');
const LOCAL = path.join(SANDBOX, 'C', '_Clients');

function resetSandbox() {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEMPLATE, 'TransIn'), { recursive: true });
    fs.mkdirSync(path.join(TEMPLATE, 'TransOut'), { recursive: true });
    fs.mkdirSync(path.join(SANDBOX, 'G', 'templates', 'DIT'), { recursive: true });
    fs.mkdirSync(path.join(SANDBOX, 'G', 'templates', 'RPAS'), { recursive: true });
    fs.mkdirSync(path.join(SANDBOX, 'ffs'), { recursive: true });
    fs.writeFileSync(path.join(TEMPLATE, 'readme.txt'), 'standard', 'utf-8');
    fs.writeFileSync(path.join(SANDBOX, 'G', 'templates', 'DIT', 'dit.txt'), 'dit', 'utf-8');
}

/** Snapshot of every path under `dir`, relative and sorted. */
function tree(dir) {
    const out = [];
    const walk = (current, prefix) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            out.push(rel);
            if (entry.isDirectory()) {
                walk(path.join(current, entry.name), rel);
            }
        }
    };
    walk(dir, '');
    return out;
}

function request(overrides = {}) {
    return {
        clientName: 'ACME',
        projectName: '2024_Test',
        creationType: 'clientProject',
        selectedDrive: path.join(SANDBOX, 'G', '_A'),
        projectType: 'Standard',
        copyToShared: false,
        transIn: { create: false, dateLabel: '2026_08_18' },
        transOut: { create: false, dateLabel: '2026_08_18' },
        syncPair: { create: false, direction: 'Update Right' },
        copyTransInFromQuote: false,
        copyOhsFromQuote: false,
        ...overrides,
    };
}

const deps = { notify: () => {}, resolveSharedRoot: () => path.join(SANDBOX, 'G', '_A') };

test('creates a project from the Standard template', async () => {
    resetSandbox();
    const result = await createProject(request(), deps);

    assert.equal(result.created, true);
    assert.ok(fs.existsSync(path.join(LOCAL, 'ACME', '2024_Test', 'readme.txt')));
    assert.ok(fs.existsSync(path.join(LOCAL, 'ACME', '2024_Test', 'TransIn')));
});

test('applies the DIT overlay only when the DIT type is selected', async () => {
    resetSandbox();
    await createProject(request({ projectType: 'Standard' }), deps);
    assert.ok(!fs.existsSync(path.join(LOCAL, 'ACME', '2024_Test', 'dit.txt')));

    resetSandbox();
    await createProject(request({ projectType: 'DIT' }), deps);
    assert.ok(fs.existsSync(path.join(LOCAL, 'ACME', '2024_Test', 'dit.txt')));
});

/**
 * The regression guard for the Phase 4 fix.
 *
 * The dated transfer folders used to be created inside the SHARED template so the
 * template copy would pick them up, then deleted again afterwards -- mutating a
 * network directory every other user reads from, mid-operation.
 *
 * A before/after snapshot is NOT enough on its own: create-then-delete leaves the
 * snapshot identical, so the old code would pass it. The watcher is what actually
 * catches the old behaviour, because it sees the write while it is happening.
 * Reads do not raise watch events, so a clean run produces none at all.
 */
test('the shared template is never modified, even transiently', async () => {
    resetSandbox();
    const templates = path.join(SANDBOX, 'G', 'templates');
    const before = tree(templates);

    const events = [];
    const watcher = fs.watch(templates, { recursive: true }, (eventType, filename) => {
        events.push(`${eventType}:${filename}`);
    });

    try {
        await createProject(
            request({
                transIn: { create: true, dateLabel: '2026_08_18' },
                transOut: { create: true, dateLabel: '2026_08_19' },
            }),
            deps
        );
        await new Promise((resolve) => setTimeout(resolve, 250)); // let events flush
    } finally {
        watcher.close();
    }

    assert.deepEqual(events, [], 'the template was written to during project creation');
    assert.deepEqual(tree(templates), before, 'the template was left altered');
});

test('dated transfer folders are created inside the new project', async () => {
    resetSandbox();
    await createProject(
        request({
            transIn: { create: true, dateLabel: '2026_08_18' },
            transOut: { create: true, dateLabel: '2026_08_19' },
        }),
        deps
    );

    const project = path.join(LOCAL, 'ACME', '2024_Test');
    assert.ok(fs.existsSync(path.join(project, 'TransIn', '2026_08_18')));
    assert.ok(fs.existsSync(path.join(project, 'TransOut', '2026_08_19')));
});

test('an existing local project is not rebuilt', async () => {
    resetSandbox();
    const project = path.join(LOCAL, 'ACME', '2024_Test');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'mine.txt'), 'do not clobber', 'utf-8');

    const messages = [];
    await createProject(request(), { ...deps, notify: (m) => messages.push(m) });

    assert.equal(fs.readFileSync(path.join(project, 'mine.txt'), 'utf-8'), 'do not clobber');
    assert.ok(!fs.existsSync(path.join(project, 'readme.txt')), 'template must not be re-copied');
    assert.ok(messages.some((m) => m.includes('already exists in C Drive')));
});

test('copies to the shared drive when asked', async () => {
    resetSandbox();
    await createProject(request({ copyToShared: true }), deps);

    assert.ok(
        fs.existsSync(path.join(SANDBOX, 'G', '_A', 'ACME', '2024_Test', 'readme.txt')),
        'project should have been copied to the resolved shared root'
    );
});

/**
 * Bug #27. The existence check and the copy must agree on which drive they mean.
 * They did not: the check used the caller's selectedDrive while the copy re-derived
 * a G path from the client name, so a project created on J landed on G.
 */
test('copies to the J root when the J drive is selected', async () => {
    resetSandbox();
    const jRoot = path.join(SANDBOX, 'J');
    const gRoot = path.join(SANDBOX, 'G', '_A');

    await createProject(request({ copyToShared: true, selectedDrive: jRoot }), {
        notify: () => {},
        // Deliberately returns a G path, exactly as getSharedDrivePath does. If the
        // service reaches for this instead of the selected drive, the next
        // assertion catches it.
        resolveSharedRoot: () => gRoot,
    });

    assert.ok(
        fs.existsSync(path.join(jRoot, 'ACME', '2024_Test', 'readme.txt')),
        'project should be on the J drive'
    );
    assert.ok(
        !fs.existsSync(path.join(gRoot, 'ACME', '2024_Test')),
        'project must not leak onto the G drive'
    );
});

/**
 * Bug #12's sharp edge. `selectedDrive` is empty until the first Search, so
 * submitting the form straight away would leave the shared root as '' and
 * path.join would yield a RELATIVE destination -- writing the project next to the
 * executable instead of onto the share.
 */
test('falls back to the resolved root when no drive has been selected yet', async () => {
    resetSandbox();
    const gRoot = path.join(SANDBOX, 'G', '_A');

    await createProject(request({ copyToShared: true, selectedDrive: '' }), {
        notify: () => {},
        resolveSharedRoot: () => gRoot,
    });

    assert.ok(
        fs.existsSync(path.join(gRoot, 'ACME', '2024_Test', 'readme.txt')),
        'should fall back to the resolved shared root'
    );
    assert.ok(
        !fs.existsSync(path.join(process.cwd(), 'ACME')),
        'must never resolve to a relative path'
    );
});

test('writes a folder pair into a config that did not exist', async () => {
    resetSandbox();
    await createProject(
        request({ syncPair: { create: true, direction: 'Update Right' } }),
        deps
    );

    // Exercises createFullXmlConfig -- the fallback that used to throw
    // ReferenceError because the function was never defined (bug #2).
    const config = fs.readFileSync(
        path.join(SANDBOX, 'ffs', 'SyncSettings.ffs_gui'),
        'utf-8'
    );
    assert.ok(config.includes('<Pair>'));
    assert.ok(config.includes('2024_Test'));
    assert.ok(!config.includes('undefined'));
});

test.after(() => {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
});
