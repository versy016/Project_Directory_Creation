// Renderer entry point AND the security boundary.
//
// The app runs with `contextIsolation: true` and `nodeIntegration: false`, so the
// page itself has no `require` and no Node access at all. This file is the only
// place with both, and it hands the page a short, named list of functions.
//
// WHY THE RENDERER LIVES HERE
// ---------------------------
// `require` disappears from page scripts the moment contextIsolation is enabled --
// verified for both nodeIntegration settings. A `<script src="script.js">` in the
// page therefore cannot load src/renderer/*. Preload scripts keep Node (given
// `sandbox: false`) and share the page's DOM, so the module tree is loaded here
// instead. The alternative was introducing a bundler, which this refactor has
// deliberately avoided.
//
// TWO THINGS TO KNOW BEFORE EDITING
// ---------------------------------
// 1. This file runs BEFORE the document is parsed. Anything touching the DOM must
//    wait for DOMContentLoaded -- see the bottom of the file.
// 2. Assigning to `window` here does NOT reach the page. It lands on the isolated
//    world's window. Inline onclick attributes in index.html and in the generated
//    table rows run in the page's main world, so anything they call has to go
//    through `contextBridge.exposeInMainWorld` below. A missed one is silent: the
//    button simply stops working.

const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

const { roots } = require('./src/config/roots');
const { loadMajorClients } = require('./src/renderer/major-clients');
const { refreshTenders, refreshClients, refreshContacts } = require('./src/services/algolia');
const { initUpdateBanner, refreshApp } = require('./src/renderer/update-banner');
const { initSyncControls } = require('./src/renderer/sync-controls');
const {
    initProjectTables,
    copyProject,
    copyFoldersOnly,
} = require('./src/renderer/project-tables');
const { initNewClientForm } = require('./src/renderer/new-client-form');
const {
    searchForClient,
    renderProjectView,
    initClientSearch,
} = require('./src/renderer/client-search');
const { initProjectFilters } = require('./src/renderer/project-filters');
const { initProjectSearch } = require('./src/renderer/project-search');
const { initNewProjectForm, createProject } = require('./src/renderer/new-project-form');

// ---------------------------------------------------------------------------
// The main-world surface
//
// Everything the page can reach, and nothing else. Each entry exists because
// something in index.html or in a generated onclick attribute calls it by name,
// or because main.js invokes it through executeJavaScript.
// ---------------------------------------------------------------------------

const MAIN_WORLD_API = {
    // Inline onclick in index.html
    refreshApp,

    // Inline onclick in the rows project-tables generates
    createProject,
    copyProject,
    copyFoldersOnly,

    // main.js calls these on did-finish-load to rebuild the search indices
    fetchAndIndexTenders: refreshTenders,
    fetchAndIndexClients: refreshClients,
    fetchAndIndexContacts: refreshContacts,
};

for (const [name, fn] of Object.entries(MAIN_WORLD_API)) {
    // Wrapped rather than passed directly so the page only ever gets a plain
    // function, never a live reference into a module.
    contextBridge.exposeInMainWorld(name, (...args) => fn(...args));
}

// ---------------------------------------------------------------------------
// Messages from the main process
// ---------------------------------------------------------------------------

// The Quote Directory option is only offered when the Accounts QT share is
// reachable. This is the app's de-facto access control for the Quotes team.
//
// Symmetric on purpose: this used to only ever hide. Combined with the value
// being computed once at startup, an app launched before Google Drive was up kept
// the option hidden for the rest of the session. Now a later `true` restores it,
// so reloading after the drive connects is enough.
ipcRenderer.on('directory-existence', (event, exists) => {
    const quoteDiv = document.querySelector('.quotediv');
    if (quoteDiv) {
        quoteDiv.style.display = exists ? 'inline' : 'none';
    }
});

// The Maps key is held in the main process. The injected <script> executes in the
// page's main world, which is where index.html's initAutocomplete callback lives.
ipcRenderer.on('api-key', (event, apiKey) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initAutocomplete`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
});

// ---------------------------------------------------------------------------
// Start up, once the document exists
// ---------------------------------------------------------------------------

function initSmallModalHandlers() {
    document.getElementsByClassName('closebtn')[0].onclick = function () {
        document.getElementById('myModal').style.display = 'none';
    };

    document.getElementsByClassName('closecopymenu')[0].onclick = function () {
        document.getElementById('copyProjectsModal').style.display = 'none';
    };

    // BUG #7 (preserved): index.html assigns its own window.onclick inside a
    // DOMContentLoaded handler. Both now run in different worlds, so they no
    // longer overwrite each other -- each sees only its own world's window.
    // Behaviour for the user is unchanged: the info-modal close still works.
    window.onclick = function (event) {
        const modal = document.getElementById('myModal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };

    // Creates the client folder locally. Distinct from the "Create New Client"
    // form, which registers a client with the ESE API.
    document.getElementById('createClientButton').addEventListener('click', () => {
        const clientName = document.getElementById('clientInput1').value.trim();
        const clientFolderPath = path.join(roots.localClients, clientName);

        try {
            fs.mkdirSync(clientFolderPath, { recursive: true });
            ipcRenderer.send('show-custom-alert', `Client "${clientName}" has been created.`);
            document.getElementById('myModal').style.display = 'none';
        } catch (error) {
            console.error('Error creating client directory:', error);
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    loadMajorClients();

    initUpdateBanner();
    initNewClientForm();
    initSmallModalHandlers();
    initSyncControls();
    // project-tables is handed searchForClient rather than importing it, which is
    // what keeps the module graph acyclic.
    initProjectTables({ onProjectsChanged: searchForClient });
    initClientSearch();
    // Changing a filter re-renders the cached search rather than re-reading disk.
    initProjectFilters({ onChange: renderProjectView });
    initProjectSearch();
    initNewProjectForm();
});
