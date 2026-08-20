# renderer/

`script.js` is now the entry point only — requires, the two main-process message
handlers, a few small modal handlers, and an ordered list of `init*()` calls. All
behaviour lives here.

| Module | Owns |
|---|---|
| `state.js` | the three shared mutable values |
| `major-clients.js` | `loadMajorClients`, the `getSharedDrivePath` adapter |
| `client-search.js` | `searchForClient`, drive toggle, client autocomplete, Refresh |
| `project-tables.js` | the two drive tables and their row buttons |
| `sync-controls.js` | the middle direction column |
| `new-project-form.js` | project/quote creation, Create Folder Pairs, Open FreefileSync |
| `new-client-form.js` | client + contact registration against the ESE API |
| `update-banner.js` | the auto-updater UI |

## Two rules

**1. Anything an inline `onclick` reaches must be on `window`.**
`index.html` and the generated table rows call `refreshApp`, `createProject`,
`copyProject`, `copyFoldersOnly` and `initAutocomplete` by name. A module-scoped
function of the same name is not reachable from an attribute, and the failure is
silent — the button just does nothing. Each module assigns its own globals in its
`init*()`. `npm run smoke` asserts all of them are present.

**2. Dependencies point one way.**

```
new-project-form ──▶ client-search ──▶ project-tables ──▶ state
                                   └─▶ sync-controls
```

`project-tables` needs to refresh the tables after a copy, which is
`client-search`'s job — the one place the graph would loop. That edge is inverted
at startup instead:

```js
initProjectTables({ onProjectsChanged: searchForClient });
```

Use the same shape for any future callback upward. Do not add a `require` that
points against the arrows; it fails at load, not at review.

## Startup order

`script.js` calls the `init*()` functions in a fixed order, and it matters in one
place: `initProjectTables` must be handed `searchForClient`, so `client-search`
must be imported (though not initialised) first. Otherwise the order follows the
order the original top-level code ran in, which keeps the last-write-wins
behaviour of the duplicated `window.onclick` assignments unchanged.
