'use strict';

const { ESE_API, ESE_AUTH } = require('./algolia');

// See the note in services/algolia.js -- node-fetch is preserved deliberately
// (bug #4), not because it is a good idea.
const fetch = require('node-fetch');

/**
 * The Engineering Surveys internal API.
 *
 * CAUTION: there is no test environment. Every call here writes to production, so
 * `npm run e2e` deliberately does not exercise this module -- it is covered by the
 * smoke test (does it load and wire up) but not behaviourally.
 *
 * Credentials live in services/algolia.js alongside the Algolia keys so Phase 6
 * has a single file to change. They are in git history and need rotating.
 */

const jsonHeaders = {
    'Content-Type': 'application/json',
    Authorization: ESE_AUTH,
};

/**
 * @param {{name: string, phone: string, email: string, updateMailchimp: boolean}} contact
 * @returns {Promise<string>} the new contact's id
 * @throws when the API rejects the request
 */
async function createContact({ name, phone, email, updateMailchimp }) {
    const response = await fetch(`${ESE_API}/contacts`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
            name,
            phone,
            email,
            active: true,
            update_mailchimp: updateMailchimp,
        }),
    });

    if (!response.ok) {
        const detail = await response.json();
        throw new Error(`HTTP error! status: ${response.status}`, detail);
    }

    return (await response.json()).id;
}

/**
 * @returns {Promise<{ok: true, data: object} | {ok: false, message: string}>}
 *   Resolves either way rather than throwing on a rejected request, because the
 *   caller shows the API's own message to the user.
 */
async function createClient(payload) {
    const response = await fetch(`${ESE_API}/clients`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('HTTP error!', errorData);
        return { ok: false, message: errorData.message };
    }

    return { ok: true, data: await response.json() };
}

module.exports = { createContact, createClient };
