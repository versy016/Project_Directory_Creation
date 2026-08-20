'use strict';

const algoliasearch = require('algoliasearch');

// BEHAVIOUR PRESERVED (bug #4, open): script.js shadows the global `fetch` with
// node-fetch v1.7.3 -- a 2017 build that is not in package.json and only resolves
// as a stale transitive dependency. Kept so this stays a pure move; Electron 30
// has a perfectly good global fetch and deleting this line is the one-line fix,
// but it changes the HTTP client under calls no test here exercises.
const fetch = require('node-fetch');

/**
 * Algolia access, both directions.
 *
 * Algolia here is a search cache in front of the ESE API, not a source of truth:
 * every index is cleared and fully rebuilt from the API on each app launch.
 *
 * SECURITY (bug #5, open): the two keys below are hardcoded and are in git
 * history, so they need rotating regardless of where they end up living. Note
 * they are not equivalent -- ADMIN_KEY permits clearObjects/saveObjects and must
 * not ship in a client at all; the long-term fix is to move the refresh* calls
 * server-side. They are gathered here so Phase 6 has one file to change.
 */
const APP_ID = 'ENGDR4U6W2';
const ADMIN_KEY = 'b999f6e45ff70ff80d4959d5e748d04c';
const SEARCH_KEY = '22d7addd0f220bff6a0f83b8a7f4e287';

const ESE_API = 'https://ese.engsurveys.com.au/api/external';

// script.js spelled this five times, three of them with a double space after
// "Basic". Both spellings are in production and both work, so they are unified on
// the canonical single-space form here.
const ESE_AUTH =
    'Basic YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg==';

const adminClient = algoliasearch(APP_ID, ADMIN_KEY);
const searchClient = algoliasearch(APP_ID, SEARCH_KEY);

const searchIndices = {
    clients: searchClient.initIndex('clients'),
    tenders: searchClient.initIndex('Tenders'),
    contacts: searchClient.initIndex('contacts'),
};

/**
 * Offline search fixture, in the same spirit as the PDC_* root overrides.
 *
 * Point PDC_FAKE_SEARCH at a JSON file of `{ "<indexName>": [ ...records ] }` and
 * every search is answered from it instead of the network, matching records whose
 * text contains all the query tokens. This is what lets `npm run e2e` exercise the
 * project search deterministically without depending on Algolia being reachable,
 * or on what happens to be in the live index today.
 *
 * Unset in normal use, so production behaviour is untouched.
 */
if (process.env.PDC_FAKE_SEARCH) {
    const fixtures = JSON.parse(require('fs').readFileSync(process.env.PDC_FAKE_SEARCH, 'utf-8'));

    const fakeIndex = (indexName) => ({
        search(query, { hitsPerPage = 20 } = {}) {
            const tokens = String(query || '')
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean);

            const hits = (fixtures[indexName] || []).filter((record) => {
                const haystack = Object.values(record).join(' ').toLowerCase();
                return tokens.every((token) => haystack.includes(token));
            });

            return Promise.resolve({ hits: hits.slice(0, hitsPerPage), nbHits: hits.length });
        },
    });

    searchIndices.clients = fakeIndex('clients');
    searchIndices.tenders = fakeIndex('Tenders');
    searchIndices.contacts = fakeIndex('contacts');
}

/**
 * Fetch a collection from the ESE API and replace an Algolia index with it.
 *
 * BEHAVIOUR PRESERVED: the index is cleared *before* the upload is confirmed, and
 * saveObjects is not awaited -- only `.catch`ed. So a failed upload after a
 * successful clear leaves the index empty until the next launch, and nothing
 * surfaces to the user. Worth fixing, but not while moving code.
 */
async function refreshIndex(collection, indexName, toRecord) {
    try {
        const response = await fetch(`${ESE_API}/${collection}`, {
            headers: { Authorization: ESE_AUTH },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        if (!json.data || !Array.isArray(json.data)) {
            throw new Error('Data is not an array or undefined');
        }

        const records = json.data.map(toRecord);
        const index = adminClient.initIndex(indexName);

        await index.clearObjects();
        index.saveObjects(records).catch((err) => {
            console.error('Error saving objects to Algolia:', err);
        });
    } catch (error) {
        console.error('An error occurred while fetching or indexing:', error);
    }
}

const refreshTenders = () =>
    refreshIndex('tenders', 'Tenders', (item) => ({
        objectID: item.ref,
        label: item.label,
        value: item.value,
        reference: item.data.reference,
        name: item.data.name,
        client_name: item.data.client_name,
        subnote: item.subnote,
    }));

const refreshClients = () =>
    refreshIndex('clients', 'clients', (item) => ({
        objectID: item.ref,
        title: item.label,
        value: item.value,
        reference: item.data.reference,
    }));

const refreshContacts = () =>
    refreshIndex('contacts', 'contacts', (contact) => ({
        objectID: contact.ref,
        label: contact.label,
        value: contact.value,
        name: contact.data.name,
        email: contact.data.email,
        phone: contact.data.phone,
        subnote: {
            Email: contact.subnote.Email,
            Phone: contact.subnote.Phone,
        },
    }));

module.exports = {
    ESE_API,
    ESE_AUTH,
    searchIndices,
    refreshTenders,
    refreshClients,
    refreshContacts,
};
