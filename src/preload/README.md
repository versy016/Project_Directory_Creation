# preload/ — done, and it lives at the repo root

The preload is `preload.js` at the project root, not in this directory —
`main.js` references it as a sibling and electron-builder ships it from there.
This file is kept as a pointer.

## What Phase 5 actually required

The plan said this would be a one-file change: re-point `services/fs-repo` at a
preload bridge and flip the flags. **That was wrong**, and worth recording.

`require` disappears from page scripts the moment `contextIsolation` is enabled —
verified for both `nodeIntegration` settings:

| Config | `require` in a page script |
|---|---|
| nodeIntegration true, contextIsolation false | available |
| nodeIntegration true, contextIsolation **true** | **gone** |
| nodeIntegration false, contextIsolation true | **gone** |

So `<script src="script.js">` could no longer load `src/renderer/*`, and the whole
module tree would have stopped loading. The two ways out were a bundler or moving
the renderer into the preload, which keeps Node (with `sandbox: false`) and shares
the page's DOM. The preload route was taken — it avoids adding build tooling that
this refactor has deliberately gone without.

`script.js` is therefore gone; `preload.js` is the renderer entry point.

## The two rules that matter

**The preload runs before the document is parsed.** Anything touching the DOM
waits for `DOMContentLoaded`. `contextBridge.exposeInMainWorld` does not — it must
run during preload evaluation, which is why the exposed functions are thin
wrappers that only touch the DOM when called.

**Assigning to `window` in the preload does not reach the page.** It lands on the
isolated world's window. Inline `onclick` attributes in `index.html` and in the
table rows `project-tables` generates all execute in the page's main world, so
anything they call has to go through `contextBridge`. A missed one is silent: the
button just stops working, with no error anywhere.

The exposed surface is a named allow-list in `preload.js` — seven functions, each
because an inline handler or `main.js` calls it by name. There is deliberately no
generic `invoke` or `ipcRenderer` bridge; that would hand the page every channel
and be barely better than `nodeIntegration`.

## Guards

- `tests/release/security.test.js` asserts the flags, that `index.html` loads no
  local scripts, that the bridge is an allow-list rather than a passthrough, and
  that no `renderer/` module requires `fs` directly.
- `npm run smoke` proves it at runtime: the page has no `require`, `process`,
  `module` or `electron`, and all seven bridged functions are present.

Both matter, because flipping `contextIsolation` back to `false` changes no visible
behaviour and would otherwise pass every other test in the suite.
