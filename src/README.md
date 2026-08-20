# src/

Target layout for the restructure. See `docs/REFACTOR.md` for the phase plan.

```
config/     drive roots and runtime settings   (populated)
core/       pure logic: no fs, no DOM, no electron   (populated)
services/   impure, but no DOM: fs, HTTP, Algolia    (Phase 4)
main/       main-process code split out of main.js   (Phase 3)
preload/    contextBridge surface                    (Phase 5)
renderer/   UI modules split out of script.js        (Phase 3)
```

## The one rule that matters

**`core/` must stay pure.** No `require('fs')`, no `require('electron')`, no
`document`. That constraint is the whole reason the test suite runs in 0.2 seconds
without a network drive mounted, and it is the thing most likely to erode under
time pressure — the moment a core module needs to read a file, the function has
been put in the wrong layer. Pass the data in instead.

Dependency direction is one-way:

```
renderer/ ──▶ services/ ──▶ core/ ──▶ config/
main/     ──▶ services/ ──▶ core/ ──▶ config/
```

Nothing in `core/` may import from `services/` or above.
