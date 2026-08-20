#!/usr/bin/env node
'use strict';

/**
 * Behavioural end-to-end run.
 *
 *   npm run e2e
 *
 * Builds a throwaway drive tree, points the app at it with the PDC_* variables,
 * and drives the real UI against it. Never touches C:\_Clients, G:, or J:.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { buildSandbox } = require('./e2e/sandbox');

const { root, env } = buildSandbox();
console.log(`  sandbox: ${root}`);

const electron = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

// electron is a .cmd on Windows, which Node will only run through a shell -- and a
// shell re-splits on spaces, so both the exe and the app path need quoting.
const useShell = process.platform === 'win32';
const quote = (value) => (useShell ? `"${value}"` : value);

const child = spawn(quote(electron), [quote(path.join(__dirname, 'e2e'))], {
  stdio: 'inherit',
  shell: useShell,
  env: { ...process.env, ...env, PDC_E2E_SANDBOX: root },
});

child.on('exit', (code) => {
  if (code === 0 && !process.env.PDC_KEEP_SANDBOX) {
    fs.rmSync(root, { recursive: true, force: true });
  } else if (code !== 0) {
    console.log(`  sandbox kept for inspection: ${root}`);
  }
  process.exit(code === null ? 1 : code);
});
