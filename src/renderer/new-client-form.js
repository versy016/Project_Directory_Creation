'use strict';

const { ipcRenderer } = require('electron');
const { searchIndices } = require('../services/algolia');
const { createContact, createClient } = require('../services/ese-api');

/**
 * The "Create New Client" form.
 *
 * DOM only -- the API calls live in services/ese-api. Note that submitting this
 * form writes to the live ESE API; there is no test environment, so `npm run e2e`
 * does not exercise it. Change it with care.
 */

function resetForm() {
    document.getElementById('CreateContact').value = false;
    document.getElementById('contactName').value = '';
    document.getElementById('emailAddress').value = '';
    document.getElementById('phoneNumber').value = '';
    document.getElementById('sendToMailChimp').checked = false;
    document.getElementById('contactId').value = '';
    document.getElementById('clientName').value = '';
    document.getElementById('esReference').value = '';
    document.getElementById('isActive').checked = false;
    document.getElementById('address').value = '';
    document.getElementById('suburb').value = '';
    document.getElementById('postcode').value = '';
    document.getElementById('copytransin').checked = false;
    document.getElementById('copyohs').checked = false;
}

async function submitClientForm(event) {
    event.preventDefault();

    let contactId = document.getElementById('contactId').value;

    if (document.getElementById('CreateContact').checked && !contactId) {
        try {
            contactId = await createContact({
                name: document.getElementById('contactName').value,
                phone: document.getElementById('phoneNumber').value,
                email: document.getElementById('emailAddress').value,
                updateMailchimp: document.getElementById('sendToMailChimp').checked,
            });
        } catch (error) {
            console.error('An error occurred while creating the contact:', error);
            return; // Do not create the client if its contact could not be created.
        }
    }

    const payload = {
        reference: document.getElementById('esReference').value,
        name: document.getElementById('clientName').value,
        active: document.getElementById('isActive').checked,
        contact_id: contactId,
        address_line_1: document.getElementById('address').value,
        address_suburb: document.getElementById('suburb').value,
        address_state: document.getElementById('state').value,
        address_postcode: document.getElementById('postcode').value,
    };

    try {
        const result = await createClient(payload);

        if (!result.ok) {
            ipcRenderer.send('show-custom-alert', `Error creating client: ${result.message}`);
            return;
        }

        ipcRenderer.send('show-custom-alert', 'Client created successfully!');
        console.log('Client created successfully:', result.data);
        resetForm();
    } catch (error) {
        console.error('An error occurred while creating the client:', error);
    }
}

/**
 * Contact autocomplete. The selected contact's details are parsed back out of the
 * rendered <li> text -- preserved as-is, but note it depends on the exact markup
 * below, so the two must change together.
 */
function initContactLookup() {
    const contactInput = document.getElementById('linkedContact');
    const contactDropdown = document.getElementById('contactDropdown');

    contactInput.addEventListener('input', function () {
        const query = this.value;

        if (query.length < 2) {
            contactDropdown.innerHTML = '';
            return;
        }

        searchIndices.contacts
            .search(query, { hitsPerPage: 10 })
            .then(({ hits }) => {
                contactDropdown.innerHTML =
                    '<ul>' +
                    hits
                        .map(
                            (hit) => `<li data-reference="${hit.name} "data-value="${hit.value}">
                                                <span class="name">${hit.name}</span><br>
                                                <span class="email">${hit.email}</span><br>
                                                <span class="phone">${hit.phone}</span>
                                            </li>`
                        )
                        .join('') +
                    '</ul>';
            })
            .catch((err) => {
                console.error('Algolia search error: ', err);
            });
    });

    contactDropdown.addEventListener('click', function (e) {
        if (e.target.tagName !== 'LI') {
            return;
        }

        const details = e.target.textContent.split('\n');
        document.getElementById('contactId').value = e.target.getAttribute('data-value');

        contactDropdown.innerHTML = '';
        contactInput.value = '';

        document.getElementById('contactName').value = details[1].trim();
        document.getElementById('emailAddress').value = details[2].trim();
        document.getElementById('phoneNumber').value = details[3].trim();
    });
}

function initNewClientForm() {
    document.getElementById('submitClientForm').addEventListener('click', submitClientForm);
    initContactLookup();
}

module.exports = { initNewClientForm, resetForm };
