# services/

Impure, but DOM-free. Everything that talks to the outside world lives here, so the
UI layer above and the pure `core/` layer below both stay testable.

| Module | Owns |
|---|---|
| `fs-repo.js` | every filesystem call the renderer makes |
| `project-service.js` | the whole create-a-project sequence |
| `algolia.js` | index refresh (write) and search indices (read) |
| `ese-api.js` | the two live writes to the ESE API |

## fs-repo is the chokepoint

Nothing above this layer imports `fs`. That is deliberate: Phase 5 turns on
`contextIsolation`, and when it does, only this file has to be re-pointed at the
preload bridge. Adding a stray `require('fs')` in a renderer module quietly
undoes that, so don't.

It also resolves `ipcRenderer` defensively rather than destructuring it at import.
The copy-progress window is a UI nicety, not part of the copy, and skipping it when
there is no renderer is what lets `project-service` be unit-tested under plain
`node --test` with no Electron at all.

## project-service takes a request, not a form

`new-project-form` reads the DOM into a plain object and calls in. The service knows
nothing about elements or checkboxes, which is why
`tests/services/project-service.test.js` can drive the whole creation sequence
against a temp directory in about 100ms.

Two arguments are injected rather than imported:

- `notify` — so alerts fire at the same points in the sequence as before, without
  the service depending on `ipcRenderer`.
- `resolveSharedRoot` — a **fallback only**, used when the mode's shared root is
  empty. That happens before the first Search (bug #12), and without the fallback
  `path.join` would build a relative destination and write the project beside the
  executable rather than onto the share.

One resolved `sharedRoot` drives both the existence check and the copy. Those
disagreeing was bug #27: a project created with the J toggle on was checked against
J but copied to G. Do not reintroduce a second derivation of that root.

## Do not write into the shared template

The dated TransIn/TransOut folders used to be created inside the shared
`_PDIR_Defaults` template so the copy would pick them up, then deleted again.
That mutated a directory every other user reads from, mid-operation. They are now
created in the new project after the copy.

`tests/services/project-service.test.js` watches the template with `fs.watch`
during creation and fails on any event. A before/after snapshot would not catch a
regression here — create-then-delete leaves the snapshot identical.
