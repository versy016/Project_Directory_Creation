const fs = require('fs');
const fr = require('fs-extra');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const algoliasearch = require('algoliasearch');
// const { shell } = require('electron'); // Import Electron's shell module
const { ipcRenderer } = require('electron');
const fetch = require('node-fetch'); // Assuming Node.js environment
const client = algoliasearch('ENGDR4U6W2', 'b999f6e45ff70ff80d4959d5e748d04c');
const index = client.initIndex('Tenders');
const { shell } = require('electron');
let drive_symbol = 'G';
const archiver = require('archiver');
const G_DRIVE_PATH = 'G:/Shared drives/ES Cloud/_Clients/FULTON HOGAN';
const THREE_MONTHS_AGO = new Date();
const ExcelJS = require('exceljs');  // Correctly importing the exceljs library
THREE_MONTHS_AGO.setMonth(THREE_MONTHS_AGO.getMonth() - 3);
let selected_drive = '';
let majorClients = [];
const majorClientsFilePath = "G:\\Shared drives\\ES Cloud\\_Admin\\IT_Utilities\\Development\\majorClients.json";


document.getElementById('searchButton').addEventListener('click', () => {
    const clientNameInput = document.getElementById('clientInput').value.trim(); // Get the input value
    if (!clientNameInput) {
        console.error('Client name input is empty.');
        return;
    }

    selected_drive = getSharedDrivePath(clientNameInput);
    console.log('Selected Drive Path:', selected_drive);

    // Add further actions with the selectedDrive path here
});

// Load the major clients from the JSON file
function loadMajorClients() {
    try {
        if (!fs.existsSync(majorClientsFilePath)) {
            console.error("Error: majorClients.json file not found at", majorClientsFilePath);
            return;
        }

        const rawData = fs.readFileSync(majorClientsFilePath, 'utf-8');
        const jsonData = JSON.parse(rawData);
        majorClients = jsonData.majorClients.map(client => client.toUpperCase()); // Convert to uppercase for case-insensitive comparison
        console.log("✅ Loaded major clients:", majorClients);
    } catch (error) {
        console.error("❌ Error loading major clients:", error);
        majorClients = []; // Fallback to empty array if file read fails
    }
}
loadMajorClients();


function getSharedDrivePath(clientName) {
    if (!clientName || typeof clientName !== 'string') {
        console.error('Invalid client name:', clientName);
        return null;
    }

    const driveBasePath = 'G:/Shared drives';

    // ✅ If client is a major client, return only the base path
    if (majorClients.includes(clientName.toUpperCase())) {
        return driveBasePath;
    }

    // ✅ Categorize other clients based on the first letter
    const firstLetter = clientName[0].toUpperCase();
    if (firstLetter >= 'A' && firstLetter <= 'Z') {
        return `${driveBasePath}/_${firstLetter}`;
    }

    // ✅ Default fallback for unrecognized cases
    return `${driveBasePath}/_Misc`;
}

// document.getElementById('archiveicon').onclick = function() {
//      processClientFolders();
//     };

// Function to get the size of a folder
async function getFolderSize(folderPath) {
    let totalSize = 0;

    console.log(`Checking folder size for: ${folderPath}`);  // Debugging info

    try {
        const files = await fr.readdir(folderPath, { withFileTypes: true });

        for (const file of files) {
            const filePath = path.join(folderPath, file.name);
            if (file.isDirectory()) {
                console.log(`Entering subfolder: ${file.name}`);  // Debugging info
                totalSize += await getFolderSize(filePath); // Recursively check subfolders
            } else {
                const fileStat = await fr.stat(filePath);
                totalSize += fileStat.size;
                console.log(`Found file: ${file.name}, Size: ${fileStat.size} bytes`);  // Debugging info
            }
        }

        return totalSize;
    } catch (error) {
        console.error(`Error reading folder ${folderPath}: ${error}`);
        return totalSize;
    }
}


// Function to find projects larger than 2.5GB and show them in the modal
async function showLargeProjects() {
    const largeFilesList = document.getElementById('largeFilesList');
    largeFilesList.innerHTML = '';  // Clear previous list
    console.log('Starting to search for large projects...');  // Debugging info

    try {
        const clientFolders = await fr.readdir(clientBasePath);
        console.log(`Found ${clientFolders.length} client folders to check`);  // Debugging info
        
        for (const clientFolder of clientFolders) {
            const clientFolderPath = path.join(clientBasePath, clientFolder);
            const folderStat = await fr.stat(clientFolderPath);

            if (folderStat.isDirectory()) {
                console.log(`Processing folder: ${clientFolder}`);  // Debugging info
                const totalSize = await getFolderSize(clientFolderPath);
                const sizeGB = (totalSize / (1024 ** 3)).toFixed(2);  // Convert bytes to GB
                console.log(`Folder size of ${clientFolder}: ${sizeGB} GB`);  // Debugging info

                if (sizeGB > 2.5) {
                    // Add to the list of large files
                    const listItem = document.createElement('li');
                    listItem.textContent = `${clientFolder}: ${sizeGB} GB`;
                    largeFilesList.appendChild(listItem);
                    console.log(`Added ${clientFolder} to the large files list`);  // Debugging info
                }
            }
        }

        // Show the modal after processing
        const modal = document.getElementById('largeFilesModal');
        console.log('Displaying the modal...');  // Debugging info
        modal.style.display = 'block';

    } catch (error) {
        console.error(`Error finding large projects: ${error}`);
    }
}

// Event listener for the Large Files icon click
// document.querySelector('.Large-Files-list-icon').addEventListener('click', async () => {
//     console.log("Large Files icon clicked");  // Debugging info
//     await showLargeProjects();
//     console.log("Finished processing large files");  // Debugging info
// });

// Close modal event listener
// document.querySelector('.close-large-files').addEventListener('click', function() {
//     document.getElementById('largeFilesModal').style.display = 'none';
//     console.log('Closed the modal');  // Debugging info
// });
// Function to get the number of files, folders, and total size
async function getFolderDetails(folderPath) {
    let totalFiles = 0;
    let totalFolders = 0;
    let totalSize = 0;

    console.log(`Reading folder: ${folderPath}`);  // Debugging info

    try {
        const files = await fr.readdir(folderPath, { withFileTypes: true });

        for (const file of files) {
            const filePath = path.join(folderPath, file.name);
            if (file.isDirectory()) {
                totalFolders++;
                console.log(`Entering subfolder: ${file.name}`);  // Debugging info
                const folderDetails = await getFolderDetails(filePath); // Recursively check subfolders
                totalFiles += folderDetails.totalFiles;
                totalSize += folderDetails.totalSize;
            } else {
                totalFiles++;
                totalSize += (await fr.stat(filePath)).size;
            }
        }

        return { totalFiles, totalFolders, totalSize };
    } catch (error) {
        console.error(`Error reading folder ${folderPath}: ${error}`);
        return { totalFiles, totalFolders, totalSize };
    }
}

// Function to generate the report and save to Excel
async function generateClientReport() {
    console.log("Starting report generation...");  // Debugging info
    const workbook = new ExcelJS.Workbook();  // Creating a new Excel workbook
    const worksheet = workbook.addWorksheet('Client Report');

    worksheet.columns = [
        { header: 'Client', key: 'client', width: 30 },
        { header: 'Total Files', key: 'totalFiles', width: 15 },
        { header: 'Total Folders', key: 'totalFolders', width: 15 },
        { header: 'Size (GB)', key: 'size', width: 15 }
    ];

    try {
        const clientFolders = await fr.readdir(clientBasePath);
        console.log(`Found ${clientFolders.length} client folders`);  // Debugging info
        for (const clientFolder of clientFolders) {
            const clientFolderPath = path.join(clientBasePath, clientFolder);
            const folderStat = await fr.stat(clientFolderPath);
            if (folderStat.isDirectory()) {
                console.log(`Processing client folder: ${clientFolder}`);  // Debugging info

                const { totalFiles, totalFolders, totalSize } = await getFolderDetails(clientFolderPath);
                const sizeGB = (totalSize / (1024 ** 3)).toFixed(2); // Convert bytes to GB and round to 2 decimal places
                worksheet.addRow({ client: clientFolder, totalFiles, totalFolders, size: sizeGB });
                console.log(`Added data for ${clientFolder}: Files = ${totalFiles}, Folders = ${totalFolders}, Size = ${sizeGB} GB`);  // Debugging info

            }
        }

        const outputPath = 'G:/Shared drives/ES Cloud/_Clients_report.xlsx';
        await workbook.xlsx.writeFile(outputPath);
        console.log(`Report generated and saved to ${outputPath}`);
    } catch (error) {
        console.error(`Error generating report: ${error}`);
    }
}

// // Event listener for the icon click
// document.querySelector('.Export-Files-list-icon').addEventListener('click', async () => {
//     await generateClientReport();
//     console.log("Report generation process finished");  // Debugging info

// });


// Zipping and deleting logic here
const zipFolder = (folderPath, zipFilePath) => {
  return new Promise((resolve, reject) => {
    const output = fr.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Zipped folder: ${folderPath}`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
};

const processClientFolders = async () => {
  try {
    const clientFolders = await fr.readdir(G_DRIVE_PATH);

    for (const clientFolder of clientFolders) {
      const clientFolderPath = path.join(G_DRIVE_PATH, clientFolder);

      if ((await fr.stat(clientFolderPath)).isDirectory()) {
        const projectFiles = await fr.readdir(clientFolderPath);

        let filesToZip = [];

        for (const file of projectFiles) {
          const filePath = path.join(clientFolderPath, file);
          const fileStats = await fr.stat(filePath);

          if (fileStats.mtime <= new Date()) {
            filesToZip.push(filePath);
          }
        }

        if (filesToZip.length > 0) {
          const zipFilePath = path.join(G_DRIVE_PATH, `${clientFolder}.zip`);
          await zipFolder(clientFolderPath, zipFilePath);
          await fr.remove(clientFolderPath);
          console.log(`Deleted folder: ${clientFolderPath}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error processing client folders: ${error.message}`);
  }
};

ipcRenderer.on('directory-existence', (event, exists) => {
  if (!exists) {
    const quoteDiv = document.querySelector('.quotediv');
    if (quoteDiv) {
      quoteDiv.style.display = 'none';
    }
  }
});
ipcRenderer.on('api-key', (event, apiKey) => {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initAutocomplete`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
});
ipcRenderer.on('update-available', () => {
  // Show some alert that an update is available and that download has started
  ipcRenderer.send('show-custom-alert', 'A new update is available. Downloading now...');
});
function refreshApp() {
    ipcRenderer.send('refresh-app');
}

//------------------------------------------------------
//  UPDATE EVENTS (AUTO UPDATER)
//------------------------------------------------------

// 1) When update is available
ipcRenderer.on('update-available', () => {
  // Show the container
  document.getElementById('updateContainer').style.display = 'block';
  
  // Update the message
  document.getElementById('updateMessage').textContent = 'A new update is available. Downloading now...';
  
  // Show the progress bar (initially at 0%)
  const progressBar = document.getElementById('updateProgressBar');
  progressBar.value = 0;
  progressBar.style.display = 'inline'; // or 'block'
});

// 2) Download progress
ipcRenderer.on('download-progress', (event, progressObj) => {
  // e.g. progressObj.percent => 0 - 100
  const progressBar = document.getElementById('updateProgressBar');
  progressBar.value = progressObj.percent;

  // Update the message with more detail
  document.getElementById('updateMessage').textContent =
    `Downloading update... ${progressObj.percent.toFixed(1)}% complete`;
});

// 3) Update downloaded
ipcRenderer.on('update-downloaded', (event, { releaseNotes, releaseName }) => {
  // Show a final message
  document.getElementById('updateMessage').textContent = 
    `Update "${releaseName}" is downloaded. Click "Install Update" to proceed.`;
  
  // Hide the progress bar
  document.getElementById('updateProgressBar').style.display = 'none';

  // Show the "Install Update" button
  const installBtn = document.getElementById('installUpdateButton');
  installBtn.style.display = 'inline';
});

// 4) Handle user clicking "Install Update"
document.getElementById('installUpdateButton').addEventListener('click', () => {
  ipcRenderer.send('install-update'); // Tells main process to call autoUpdater.quitAndInstall()
});


// Function to fetch tenders from your API and format them for Algolia
window.fetchAndIndexTenders = async() => {
    try {
        const response = await fetch('https://ese.engsurveys.com.au/api/external/tenders', {
            headers: {
                'Authorization': 'Basic  YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg==' 
            }
        });

        // Make sure the response is OK
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        // Make sure that data is defined and is an array
        if (!json.data || !Array.isArray(json.data)) {
            throw new Error('Data is not an array or undefined');
        }
        // Format data for Algolia
        const records = json.data.map(item => ({
            objectID: item.ref, // Algolia requires an objectID for each item
            label: item.label,
            value: item.value,
            reference: item.data.reference,
            name: item.data.name,
            client_name: item.data.client_name,
            subnote: item.subnote
        }));
        await index.clearObjects();

        // Upload data to Algolia
        index.saveObjects(records)
            .catch(err => {
                console.error('Error saving objects to Algolia:', err);
            });
    } catch (error) {
        console.error('An error occurred while fetching or indexing:', error);
    }
}
window.fetchAndIndexClients = async () => {
    try {
        const client = algoliasearch('ENGDR4U6W2', 'b999f6e45ff70ff80d4959d5e748d04c');
        const clientsIndex = client.initIndex('clients');

        const response = await fetch('https://ese.engsurveys.com.au/api/external/clients', {
            headers: {
                'Authorization': 'Basic YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg==' 
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        if (!json.data || !Array.isArray(json.data)) {
            throw new Error('Data is not an array or undefined');
        }

        // Clear the index before adding new objects
        await clientsIndex.clearObjects();

        const records = json.data.map(item => ({
            objectID: item.ref,
            title: item.label,
            value: item.value,
            reference: item.data.reference,
        }));

        // Upload data to Algolia
        clientsIndex.saveObjects(records)
           .catch(err => {
                console.error('Error saving objects to Algolia:', err);
            });
    } catch (error) {
        console.error('An error occurred while fetching or indexing:', error);
    }

};

document.getElementById('submitClientForm').addEventListener('click', async (event) => {
    event.preventDefault(); // Prevent default form submission
    const createContactCheckbox = document.getElementById('CreateContact');
    const contactName = document.getElementById('contactName').value;
    const contactEmail = document.getElementById('emailAddress').value;
    const contactPhone = document.getElementById('phoneNumber').value;
    const updateMailchimp = document.getElementById('sendToMailChimp').checked;
    let contactId = document.getElementById('contactId').value; // This might be empty if a new contact needs to be created

    if (createContactCheckbox.checked && !contactId) {
        // If the Create New Contact is checked and there is no contactId, create the contact first
        const contactPayload = {
            name: contactName,
            phone: contactPhone,
            email: contactEmail,
            active: true, // Assuming the new contact should be active
            update_mailchimp: updateMailchimp
        };
        
        try {
            const contactResponse = await fetch('https://ese.engsurveys.com.au/api/external/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg=='
                },
                body: JSON.stringify(contactPayload)
            });

            if (!contactResponse.ok) {
                const contactError = await contactResponse.json();
                throw new Error(`HTTP error! status: ${contactResponse.status}`, contactError);
            }

            const contactData = await contactResponse.json();
            contactId = contactData.id; // Use the ID from the newly created contact for the client creation
        } catch (error) {
            console.error('An error occurred while creating the contact:', error);
            // Handle the contact creation error response here
            return; // Stop the client creation if contact creation failed
        }
    }
    
    // Get the form values
    const clientName = document.getElementById('clientName').value;
    const esReference = document.getElementById('esReference').value;
    const isActive = document.getElementById('isActive').checked;
    const addressLine1 = document.getElementById('address').value;
    const addressSuburb = document.getElementById('suburb').value;
    const addressState = document.getElementById('state').value;
    const addressPostcode = document.getElementById('postcode').value;

    // Construct the payload
    const payload = {
        reference: esReference,
        name: clientName,
        active: isActive,
        contact_id: contactId, // The actual contact ID should be retrieved from your contacts logic
        address_line_1: addressLine1,
        address_suburb: addressSuburb,
        address_state: addressState,
        address_postcode: addressPostcode
    };

    // Send the POST request
    try {
        const response = await fetch('https://ese.engsurveys.com.au/api/external/clients', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic  YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg=='
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            ipcRenderer.send('show-custom-alert', `Error creating client: ${errorData.message}`);
            console.error('HTTP error!', errorData);
            return;
        }

        const json = await response.json();
        ipcRenderer.send('show-custom-alert', 'Client created successfully!');

        console.log('Client created successfully:', json);
        resetForm();

        contactId = ''; 
        // Handle the success response here, maybe update UI or alert the user
    } catch (error) {
        console.error('An error occurred while creating the client:', error);
        // Handle the error response here
    }
});
function resetForm() {
    document.getElementById('CreateContact').value = false;
    document.getElementById('contactName').value =  '';
    document.getElementById('emailAddress').value = '';
    document.getElementById('phoneNumber').value = '';
    document.getElementById('sendToMailChimp').checked  = false;
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
window.fetchAndIndexContacts = async () => {
    try {
        const contactIndex = client.initIndex('contacts');
        const response = await fetch('https://ese.engsurveys.com.au/api/external/contacts', {
            headers: {
                'Authorization': 'Basic  YzQ4OGQ3MmE3YzRhZTE4MjRkMzQ5NjMwNGI0OGUyYmE4NWZmZWVjMzY0NzczNjMwYmZjYWZhZjM2ZGIxYmJkZg==' // Your API key
            }
        });

        // Make sure the response is OK
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();

        // Make sure that data is defined and is an array
        if (!json.data || !Array.isArray(json.data)) {
            throw new Error('Data is not an array or undefined');
        }

        // Format data for Algolia
        const records = json.data.map(contact => ({
            objectID: contact.ref, // Algolia requires an objectID for each item
            label: contact.label,
            value: contact.value,
            name: contact.data.name,
            email: contact.data.email,
            phone: contact.data.phone,
            subnote: {
                Email: contact.subnote.Email,
                Phone: contact.subnote.Phone
            }
        }));
        await contactIndex.clearObjects();

        // Upload data to Algolia
        contactIndex.saveObjects(records)
            .catch(err => {
                console.error('Error saving objects to Algolia:', err);
            });
    } catch (error) {
        console.error('An error occurred while fetching or indexing:', error);
    }
};


// Function to read directories and return project names
function readProjectsFromDirectory(directoryPath) {
    return new Promise((resolve, reject) => {
      fs.readdir(directoryPath, { withFileTypes: true }, (err, entries) => {
        if (err) {
          reject(err);
          return;
        }
        const folders = entries
          .filter(entry => entry.isDirectory())
          .map(folder => folder.name);
        resolve(folders);
      });
    });
  }


// Function to return correct base directories based on selection
function getBaseDirectories() {
    const selectedValue = document.querySelector('input[name="creationType"]:checked').value;

    if (selectedValue === 'clientProject') {
        console.log("📂 Searching in Client Projects (C and G Drives)");
        return ['C:\\_Clients', selected_drive];  // Normal client projects

    } else if (selectedValue === 'quoteDirectory') {
        console.log("📂 Searching in Quote Directory (C and G Drives)");
        return ['C:\\__Accounts\\__Clients', 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients'];
    }

    return [];  // Default empty array to prevent crashes
}


document.addEventListener('DOMContentLoaded', function() {
    // Function to check the state of the radio buttons and hide/show the toggle switch
    function updateToggleVisibility() {
        var quoteDirectoryRadio = document.querySelector('input[name="creationType"][value="quoteDirectory"]');
        var driveContainer = document.getElementById('driveContainter');
        if (quoteDirectoryRadio.checked) {
            driveContainer.style.display = 'none'; // Hide the toggle switch
        } else {
            driveContainer.style.display = 'block'; // Show the toggle switch
        }
    }

    // Attach event listeners to radio buttons for changes
    var creationTypeRadios = document.querySelectorAll('input[name="creationType"]');
    creationTypeRadios.forEach(function(radio) {
        radio.addEventListener('change', updateToggleVisibility);
    });

    // Call the function on page load to set the correct initial visibility
    updateToggleVisibility();
});

document.getElementById('driveToggle').addEventListener('change', function () {
    const clientName = document.getElementById('clientInput').value.trim();

    if (this.checked) {
        console.log('Switch to J drive version');
        document.getElementById('switchid').textContent = 'Switch to Sync C & G';
        document.getElementById('gDriveHeading').textContent = 'J Drive Projects:';
        document.querySelector('.quotediv').style.display = 'none';

        selected_drive = 'J:\\__Clients';
        drive_symbol = 'J';
        if (clientName === '') {
            return;
        }
        searchForClient(clientName, true);

    } else {
        console.log('Switch to G drive version');
        document.getElementById('switchid').textContent = 'Switch to Sync C & J';
        document.getElementById('gDriveHeading').textContent = 'G Drive Projects:';
        selected_drive = getSharedDrivePath(clientName);
        drive_symbol = 'G';
        document.querySelector('.quotediv').style.display = 'inline';
        if (clientName === '') {
            return;
        }
        searchForClient(clientName, true);
    }
});



async function searchForClient(clientName, refresh) {
     
    let baseDirectories = getBaseDirectories();

    // Update baseDirectories based on radio selection
    document.querySelectorAll('input[name="creationType"]').forEach(input => {
        input.addEventListener('change', () => {
            baseDirectories = getBaseDirectories();
        });
    });


    
    // // Map over the base directories and construct the full path
    // const sharedDrivePath = getSharedDrivePath(clientName);
    //     const directoryPaths = [
    //         path.join("C:/_Clients", clientName),
    //         path.join(sharedDrivePath, clientName)
    //     ];

    const directoryPaths = baseDirectories.map(dir => path.join(dir, clientName));

    // Get the list of subdirectories for each client path
    const searchResults = await Promise.all(directoryPaths.map(async (clientPath) => {
        try {
            return await readProjectsFromDirectory(clientPath);
        } catch (err) {
            console.error(`Error reading directory ${clientPath}: `, err);
            return []; // Return an empty array in case of an error
        }
    }));
    function extractYearFromProjectName(projectName) {
        const yearMatch = projectName.match(/E?(20\d{2})/);
        return yearMatch ? parseInt(yearMatch[1], 10) : null;
    }


    // Sort function to order projects
    function sortProjects(projects) {
        return projects.sort((a, b) => {
        const yearA = extractYearFromProjectName(a);
        const yearB = extractYearFromProjectName(b);

        // If both projects have a year, sort by year in descending order
        if (yearA !== null && yearB !== null) {
        return yearB - yearA; // Descending order by year
        } else if (yearA !== null) {
        return -1; // Projects with a year come before those without
        } else if (yearB !== null) {
        return 1; // Projects with a year come before those without
        } else {
        // If neither project has a year, sort by the project name itself
        return a.localeCompare(b);
        }
    });
}
    const commonProjects = searchResults[0].filter(project => searchResults[1].includes(project));
    const uniqueCProjects = searchResults[0].filter(project => !searchResults[1].includes(project));
    const uniqueGProjects = searchResults[1].filter(project => !searchResults[0].includes(project));

    const sortedCommonProjects = sortProjects(commonProjects);
    const sortedUniqueCProjects = sortProjects(uniqueCProjects);
    const sortedUniqueGProjects = sortProjects(uniqueGProjects);

    // Combined lists with common projects first, in descending order by year
    const combinedCProjects = [...sortedCommonProjects, ...sortedUniqueCProjects];
    const combinedGProjects = [...sortedCommonProjects, ...sortedUniqueGProjects];
   
    let cpath = path.join('C:\\_Clients', clientName);
    let gpath = path.join(selected_drive, clientName);
    let xmlConfigData = '';
    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    if (selected_drive == 'J:\\__Clients') {
        xmlConfigData = await readAndProcessXmlConfig('C:\\Freefilesyncfiles\\SyncSettingsJdrive.ffs_gui');
    }
    else {
                xmlConfigData = await readAndProcessXmlConfig('C:\\Freefilesyncfiles\\SyncSettings.ffs_gui');

    }
    

    if (selectedCreationType === 'quoteDirectory') {

        cpath = path.join('C:\\__Accounts\\__Clients', clientName);
        gpath = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName);
        xmlConfigData = await readAndProcessXmlConfig('C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui');
    }
    
     

    // Populate the UI with the results
    populateProjects(combinedCProjects, 'cDriveProjects', cpath);
    populateProjects(combinedGProjects, 'gDriveProjects', gpath);
    populateDirectionColumn(sortedCommonProjects, xmlConfigData); // Pass only the common, since they're synced
    
    
    // const missingProjects = searchResults[1].filter(project => !searchResults[0].includes(project));

    // if (missingProjects.length > 0) {
       
    //     copygtoc(missingProjects, clientName)
    // }

    // const projectsInCNotInG = searchResults[0].filter(project => !searchResults[1].includes(project));

    // if (projectsInCNotInG.length > 0 && refresh === false ) {
    //     // Populate the modal with checkboxes for each missing project

    //     // // Change the text of the <h2> element
    //     var h2Element = document.querySelector('#copyProjectsModal h2');
    //     h2Element.textContent = 'Select Projects to Copy From C Drive to G Drive';

    //     const copyProjectsList = document.getElementById('copyProjectsList');
    //     copyProjectsList.innerHTML = '';
    //     projectsInCNotInG.forEach(project => {
    //         const checkbox = document.createElement('input');
    //         checkbox.type = 'checkbox';
    //         checkbox.id = project;
    //         checkbox.value = project;

    //         const label = document.createElement('label');
    //         label.htmlFor = project;
    //         label.textContent = project;

    //         const div = document.createElement('div');
    //         div.appendChild(checkbox);
    //         div.appendChild(label);

    //         copyProjectsList.appendChild(div);
    //     });

    //     // Show the modal
    //     const copyProjectsModal = document.getElementById('copyProjectsModal');
    //     copyProjectsModal.style.display = 'block';

    //     // Handle the confirm copy button click for C to G
    //     document.getElementById('confirmCopyButton').addEventListener('click', async () => {
    //         const selectedProjects = [];
    //         const copyProjectsList = document.getElementById('copyProjectsList'); // Assuming this is your list element
    //         copyProjectsList.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
    //             selectedProjects.push(checkbox.value);
    //         });
        
    //         // Determine the base directories based on the current selection of radio buttons
    //         const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    //         let sourceBasePath, destBasePath;
        
    //         if (selectedCreationType === 'clientProject') {
    //             sourceBasePath = 'C:\\_Clients';
    //             destBasePath = 'G:\\Shared drives\\ES Cloud\\_Clients';
    //         } else if (selectedCreationType === 'quoteDirectory') {
    //             sourceBasePath = 'C:\\__Accounts\\__Clients';
    //             destBasePath = 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients';


    //         }
        
    //         // Copy the selected projects
    //         for (const projectName of selectedProjects) {
    //             const sourcePath = path.join(sourceBasePath, clientName, projectName);
    //             const destPath = path.join(destBasePath, clientName, projectName);
        
    //             try {
    //                 await copyDirectory(sourcePath, destPath);
    //                 console.log(`Copied ${projectName} to ${destBasePath}.`);
    //             } catch (err) {
    //                 console.error(`Failed to copy ${projectName}: `, err);
    //             }
    //         }
        
    //         // Hide the modal and possibly refresh the client search
    //         copyProjectsModal.style.display = 'none';
    //         copygtoc(missingProjects,clientName)

    //         // Optionally refresh the client search or update the UI as needed
    //         // searchForClient(clientName); // Uncomment or modify as needed based on your application's flow
    //     });
        
    //     document.getElementById('skipButton').addEventListener('click', () => {
            
    //         copyProjectsModal.style.display = 'none';
    //         copygtoc(missingProjects,clientName)
         
    // });
    // }
   
}
function copygtoc(missingProjects, clientName){

    if (missingProjects.length > 0) {

    var h2Element = document.querySelector('#copyProjectsModal h2');

    // Change the text of the <h2> element
        h2Element.textContent = 'Select Projects to Copy From G Drive to C Drive';
        // Populate the modal with checkboxes for each missing project
        const copyProjectsList = document.getElementById('copyProjectsList');
        copyProjectsList.innerHTML = '';
        missingProjects.forEach(project => {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = project;
            checkbox.value = project;

            const label = document.createElement('label');
            label.htmlFor = project;
            label.textContent = project;

            const div = document.createElement('div');
            div.appendChild(checkbox);
            div.appendChild(label);

            copyProjectsList.appendChild(div);
        });

        // Show the modal
        const copyProjectsModal = document.getElementById('copyProjectsModal');
        copyProjectsModal.style.display = 'block';

        document.getElementById('confirmCopyButton').addEventListener('click', async () => {
            const selectedProjects = [];
            const copyProjectsList = document.getElementById('copyProjectsList'); // Assuming this is your list element
            copyProjectsList.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
                selectedProjects.push(checkbox.value);
            });
        
            // Determine the base directories based on the current selection of radio buttons
            const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
            let sourceBasePath, destBasePath;
        
            if (selectedCreationType === 'clientProject') {
                 destBasePath = 'C:\\_Clients';
                 sourceBasePath = selected_drive;
            } else if (selectedCreationType === 'quoteDirectory') {
                destBasePath = 'C:\\__Accounts\\__Clients';
                 sourceBasePath= 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients';
            }
        
            // Copy the selected projects
            for (const projectName of selectedProjects) {
                const sourcePath = path.join(sourceBasePath, clientName, projectName);
                const destPath = path.join(destBasePath, clientName, projectName);
        
                try {
                    await copyDirectory(sourcePath, destPath);
                    console.log(`Copied ${projectName} to ${destBasePath}.`);
                } catch (err) {
                    console.error(`Failed to copy ${projectName}: `, err);
                }
            }
        
            // Hide the modal and possibly refresh the client search
            copyProjectsModal.style.display = 'none';
          
    
        });
        
        document.getElementById('skipButton').addEventListener('click', () => {
            
            copyProjectsModal.style.display = 'none';
           
    });
    }
    else
    {
        return;
    }

}
// Function to copy directory content from source to destination
async function copyDirectory(source, destination) {
    // Tell the main process to show "Copying in progress" dialog
    await ipcRenderer.invoke('show-copying-in-progress');

    try {
        await fs.promises.cp(source, destination, { recursive: true });
        // Tell the main process to close the dialog once copying is done
        await ipcRenderer.invoke('close-copying-in-progress');
        return true;
    } catch (err) {
        console.error('Copy failed:', err);
        await ipcRenderer.invoke('close-copying-in-progress');
        return false;
    }
}

// Function to read subfolders from a directory
function readSubfolders(directoryPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(directoryPath, { withFileTypes: true }, (err, files) => {
            if (err) {
                reject(err);
            } else {
                // Filter directories and map to their names
                const subfolders = files
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);
                resolve(subfolders);
            }
        });
    });
}

// Event listener for the Search button
// When the user clicks the button, open the modal 
document.getElementById('searchclientButton').addEventListener('click', async () => {
    const clientName = document.getElementById('clientInput1').value.trim();
    if (clientName === '') {
            ipcRenderer.send('show-custom-alert', 'Please enter a client name.');
            return;
        }
    else{
    let clientFolderPathC = path.join('C:\\_Clients', clientName);
    let clientFolderPathG = path.join(selected_drive, clientName);

    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    if (selectedCreationType === 'quoteDirectory') {

        clientFolderPathC = path.join('C:\\__Accounts\\__Clients', clientName);
        clientFolderPathG = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName);
    }

    const subfoldersContainerC = document.getElementById('subfoldersContainerC');
    const subfoldersContainerG = document.getElementById('subfoldersContainerG');
    const subfoldersHeadingC = document.getElementById('subfoldersHeadingC');
    const subfoldersHeadingG = document.getElementById('subfoldersHeadingG');

    // Clear previous results and hide headings
    subfoldersContainerC.innerHTML = '';
    subfoldersContainerG.innerHTML = '';
    subfoldersHeadingC.style.display = 'none';
    subfoldersHeadingG.style.display = 'none';

    try {
        // Load and display C Drive projects
        if (fs.existsSync(clientFolderPathC)) {
            const subfoldersC = await readSubfolders(clientFolderPathC);
            if (subfoldersC.length > 0) {
                subfoldersHeadingC.style.display = 'block';
                for (const subfolder of subfoldersC) {
                    const folderSize = await getFolderSize(path.join(clientFolderPathC, subfolder));
                    const li = document.createElement('li');
                    li.textContent = `${subfolder} - ${formatBytes(folderSize)}`;
                    subfoldersContainerC.appendChild(li);
                }
            } else {
                subfoldersHeadingC.style.display = 'block';
                subfoldersContainerC.textContent = 'No projects exist.';
            }
        } else {
            subfoldersHeadingC.style.display = 'block';
            subfoldersContainerC.textContent = 'Client not found.';
        }

        // Load and display G Drive projects
        if (fs.existsSync(clientFolderPathG)) {
            const subfoldersG = await readSubfolders(clientFolderPathG);
            if (subfoldersG.length > 0) {
                subfoldersHeadingG.style.display = 'block';
                for (const subfolder of subfoldersG) {
                    const folderSize = await getFolderSize(path.join(clientFolderPathG, subfolder));
                    const li = document.createElement('li');
                    li.textContent = `${subfolder} - ${formatBytes(folderSize)}`;
                    subfoldersContainerG.appendChild(li);
                }
            } else {
                subfoldersHeadingG.style.display = 'block';
                subfoldersContainerG.textContent = 'No projects exist.';
            }
        } else {
            subfoldersHeadingG.style.display = 'block';
            subfoldersContainerG.textContent = 'Client not found.';
        }
    } catch (error) {
        console.error('Error:', error);
    }
}
});

// Helper function to calculate folder size recursively
async function getFolderSize(folderPath) {
    let totalSize = 0;
    const files = await fs.promises.readdir(folderPath, { withFileTypes: true });

    for (const file of files) {
        const fullPath = path.join(folderPath, file.name);
        if (file.isDirectory()) {
            totalSize += await getFolderSize(fullPath); // Recursively sum folder sizes
        } else {
            const stats = await fs.promises.stat(fullPath);
            totalSize += stats.size;
        }
    }
    return totalSize;
}

// Function to format size in bytes to a more readable format
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// When the user clicks on <span> (x), close the modal
document.getElementsByClassName('closebtn')[0].onclick = function() {
    const modal = document.getElementById('myModal');
    modal.style.display = "none";
}
document.getElementsByClassName('closecopymenu')[0].onclick = function() {
    const modal = document.getElementById('copyProjectsModal');
    modal.style.display = "none";
}
// When the user clicks anywhere outside of the modal, close it
window.onclick = function(event) {
    const modal = document.getElementById('myModal');
    if (event.target === modal) {
        modal.style.display = "none";
    }
}

// When the user clicks the "Create Client" button, create the client
document.getElementById('createClientButton').addEventListener('click', () => {
    const clientName = document.getElementById('clientInput1').value.trim();
    const clientFolderPath = path.join('C:\\_Clients', clientName);
    try {
        // Create the directory
        fs.mkdirSync(clientFolderPath, { recursive: true });
        ipcRenderer.send('show-custom-alert', `Client "${clientName}" has been created.`);
        // Close the modal
        document.getElementById('myModal').style.display = "none";
    } catch (error) {
        console.error('Error creating client directory:', error);
    }
});


document.getElementById('createSyncFolderPair').addEventListener('change', (event) => {
    document.getElementById('directioncell').style.display = event.target.checked ? 'flex' : 'none';
});

async function copyToGDrive(clientName, newProjectPath, newProjectName) {
    
    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;


    // Determine the correct shared drive base path
    let sharedDrivePath = selectedCreationType === 'quoteDirectory'
        ? "G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients"
        : getSharedDrivePath(clientName);

    console.log("📂 Shared Drive Base Path:", sharedDrivePath);

    // Build the correct client folder path
    const gDriveClientPath = path.join(sharedDrivePath, clientName);
    console.log("📂 Client Path in G Drive:", gDriveClientPath);

    // Ensure the client folder exists
    await fs.promises.mkdir(gDriveClientPath, { recursive: true });
    console.log("✅ Ensured client folder exists:", gDriveClientPath);

    // Construct the final project path
    const gDriveProjectPath = path.join(gDriveClientPath, newProjectName);
    console.log("📂 Final Project Path in G Drive:", gDriveProjectPath);

    // Check if project already exists before copying
    if (!fs.existsSync(gDriveProjectPath)) {
        await copyDirectory(newProjectPath, gDriveProjectPath);
        console.log("✅ Successfully copied to G Drive:", gDriveProjectPath);
        return true;
    } else {
        ipcRenderer.send("show-custom-alert", "Project already exists in the shared drive.");
        return false;
    }
}


document.addEventListener('DOMContentLoaded', function () {
    const copyToGDriveLabel = document.querySelector('label[for="copyToGDrive"]');
    const creationTypeRadios = document.querySelectorAll('input[name="creationType"]');

    function updateGDriveLabel() {
        const selectedType = document.querySelector('input[name="creationType"]:checked').value;
        if (selectedType === 'quoteDirectory') {
            copyToGDriveLabel.textContent = 'Copy quote to G Drive';
        } else {
            copyToGDriveLabel.textContent = 'Copy project to G Drive';
        }
    }

    creationTypeRadios.forEach(radio => {
        radio.addEventListener('change', updateGDriveLabel);
    });

    updateGDriveLabel(); // Initialize on page load
});


document.getElementById('enterManually').addEventListener('click', function(event) {
            event.preventDefault();
            const currentYear = new Date().getFullYear();
            document.getElementById('newProjectName').value = currentYear + '_';
            document.getElementById('newProjectNameDropdown').classList.remove('active');
            this.style.display = 'none';
            document.getElementById('SearchProject').style.display = 'inline';
            
        });

document.getElementById('SearchProject').addEventListener('click', function(event) {
            event.preventDefault();
            document.getElementById('newProjectName').value = '';
            document.getElementById('newProjectNameDropdown').classList.add('active');
            this.style.display = 'none';
            document.getElementById('enterManually').style.display = 'inline';
});
document.getElementById('btnSubmit').addEventListener('click', async (event) => {
    event.preventDefault(); // Prevent the form from submitting in the traditional way

    const newProjectNameInput = document.getElementById('newProjectName');
   
    const standardRadio = document.getElementById('standard');
    const ditRadio = document.getElementById('dit');
    const rpasRadio = document.getElementById('rpas');
    const copyToGDriveCheckbox = document.getElementById('copyToGDrive');
    const createtransinCheckbox = document.getElementById('createtransin');
    const createtransoutCheckbox = document.getElementById('createtransout');
    const copyTransIn = document.getElementById('copytransin');
    const copyOHS= document.getElementById('copyohs');

    const createSyncFolderPairCheckbox = document.getElementById('createSyncFolderPair');

    // Retrieve the client name from the input with id 'clientInput1'
    const clientName = document.getElementById('clientInput').value.trim();
    let newProjectName = newProjectNameInput.value.trim();
    newProjectName = newProjectName.replace(/'/g, '');
    newProjectNameInput.dispatchEvent(new Event('input')); 
    newProjectName = newProjectName.replace(/['"]/g, '').replace(/\s+/g, '_');

 // Regular expression pattern for valid project names
    const projectNamePattern = /^(E(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)\d{4}_[\w\s\/-]+|C\d{8}_[\w\s\/-]+|(201[0-9]|202[0-9]|203[0-9]|204[0-9]|2050)_[\w\s\/-]+)$/;

    let projectPrefix = '';
    // Validation
    if (!clientName) {
        ipcRenderer.send('show-custom-alert', 'Please enter a client name.');
        return;
    }

    if (!newProjectName) {
        ipcRenderer.send('show-custom-alert', 'Please enter a project name.');
        return;
    }

    if (!projectNamePattern.test(newProjectName.trim())) {
        ipcRenderer.send('show-custom-alert', 'Invalid project name format. It must start with "YYYY_", "E" followed by 8 digits, or "C" followed by 8 digits.');
        return;
    }


    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;

    if (!standardRadio.checked && !ditRadio.checked && !rpasRadio.checked) {
        if (selectedCreationType === 'clientProject') {
           
        alert('Please select a project type.');
        return;
        }
    }
    

    if (projectPrefix) {
        newProjectName = `${projectPrefix}_${newProjectName}`;
    }
    let basePath = 'G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults';

    let standardFolderPath = path.join(basePath, '_Standard');
    let ditFolderPath = path.join(basePath, 'DIT');
    let rpasFolderPath = path.join(basePath, 'RPAS');

    // Construct the new project path
    
    let clientFolderPathC = path.join('C:\\_Clients', clientName);
    let clientFolderPathG = path.join(selected_drive, clientName);
    

    if (selectedCreationType === 'quoteDirectory') {

        standardFolderPath = 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults';
        clientFolderPathC = path.join('C:\\__Accounts\\__Clients', clientName);
        clientFolderPathG = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName);
    }

    const newProjectPathC = path.join(clientFolderPathC, newProjectName);
    const newProjectPathG = path.join(clientFolderPathG, newProjectName);

    // Check if project already exists in both C and G Drives
    const projectExistsInCDrive = fs.existsSync(newProjectPathC);
    const projectExistsInGDrive = fs.existsSync(newProjectPathG);

    if (projectExistsInCDrive) {
        ipcRenderer.send('show-custom-alert', `Project "${newProjectName}" already exists in C Drive.`);
    }

    if (projectExistsInGDrive) {
       ipcRenderer.send('show-custom-alert', `Project "${newProjectName}" already exists in G Drive.`);
    }

    if (projectExistsInCDrive && projectExistsInGDrive) {
        return; // Terminate project creation if exists in both drives
    }

    try {
        if (!projectExistsInCDrive) {
            // Create the new project folder in C Drive
            if (createtransinCheckbox.checked) {
                const today = document.getElementById('datePlaceholder').textContent; // Gets today's date in YYYY-MM-DD format
                
                let transInFolderPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults\\TransIn\\${today}`;
                if(selectedCreationType === "clientProject"){
                    transInFolderPath = `G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard\\TransIn\\${today}`;
                    console.log(transInFolderPath);
                }
                await fs.promises.mkdir(transInFolderPath, { recursive: true });
            }
            if (createtransoutCheckbox.checked) {
                const today = document.getElementById('datePlaceholder1').textContent; // Gets today's date in YYYY-MM-DD format
                let transoutFolderPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults\\TransOut\\${today}`;
                if(selectedCreationType === "clientProject"){
                    transoutFolderPath = `G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard\\TransOut\\${today}`;
                    console.log(transoutFolderPath);

                }
                await fs.promises.mkdir(transoutFolderPath, { recursive: true });
            }
            await fs.promises.mkdir(newProjectPathC, { recursive: true });
          
            // Always copy the standard files over to the new project folder
            await copyDirectory(standardFolderPath, newProjectPathC);

            // Copy additional files if DIT or RPAS is selected
            if (ditRadio.checked) {
                await copyDirectory(ditFolderPath, newProjectPathC);
            }
            if (rpasRadio.checked) {
                await copyDirectory(rpasFolderPath, newProjectPathC);
            }
        }
        
        if (copyToGDriveCheckbox.checked && !projectExistsInGDrive) {
            let destinationPathG = '';

            if (selectedCreationType === 'clientProject') {
                // ✅ Copy to regular G Drive project folder
                destinationPathG = path.join(clientFolderPathG, newProjectName);
                ipcRenderer.send('show-custom-alert', 'Project successfully copied to G Drive.');
            } else if (selectedCreationType === 'quoteDirectory') {
                // ✅ Copy quotes to tender folder area
                destinationPathG = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName, newProjectName);
                ipcRenderer.send('show-custom-alert', 'Quote successfully copied to Tender folder in G Drive.');
            }

            if (destinationPathG) {
                await copyToGDrive(clientName, newProjectPathC, newProjectName, destinationPathG);
            }
        }


        // Additional logic if Create Sync Folder Pair is checked...
        if (createSyncFolderPairCheckbox.checked) {
            const projects = [];
            const directionDropdown = document.querySelector('.newdirection-dropdown');

            projects.push({
                name: newProjectName, // Correctly getting the project name from the attribute
                direction: directionDropdown.value,
                syncEnabled: true
            });
            if (projects.length === 0) {
                ipcRenderer.send('show-custom-alert', 'No projects selected for synchronization.');
                return;
            }
            
            // Read the existing XML configuration
            let existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettings.ffs_gui');
            if (selectedCreationType === 'clientProject') {

                existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettings.ffs_gui');

            }
            else 
                {
                    existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui');

                }

            // Parse existing pairs into a set
            const existingPairsSet = parseExistingPairsToSet(existingXmlConfig || '');
            console.log(existingPairsSet);
        
        
            // Generate folder pairs XML from sync settings, passing the existing pairs set
            const folderPairsXml = generateFolderPairsXml(clientName, projects, existingPairsSet);
        
            // Append the new folder pairs to the existing XML
            const updatedXmlConfig = existingXmlConfig ?
                appendFolderPairsToExistingXml(existingXmlConfig, folderPairsXml) :
                createFullXmlConfig(folderPairsXml); // Handle the case where existingXmlConfig is null
        
            let xmlConfigPath='';
            // Save the updated XML configuration back to the file
            if (selectedCreationType === 'clientProject') {
                if (selected_drive == 'J:\\__Clients') {
                    xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettingsJdrive.ffs_gui';
                }
                else {
                    xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettings.ffs_gui';
                }
            }
            else 
                {
                    xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui';
                }

            try {
                await fs.promises.writeFile(xmlConfigPath, updatedXmlConfig, 'utf-8');
                ipcRenderer.send('show-custom-alert', 'Project created successfully.');

            } catch (error) {
                console.error('Failed to write XML configuration or execute sync:', error);
               ipcRenderer.send('show-custom-alert', 'An error occurred while setting up the synchronization.');
            }
    
        }
        if (createtransinCheckbox.checked) {
            const today = document.getElementById('datePlaceholder').textContent; 
            let transInFolderPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults\\TransIn\\${today}`;
            if(selectedCreationType === "clientProject"){
                transInFolderPath = `G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard\\TransIn\\${today}`;
            }
            await fs.promises.rmdir(transInFolderPath, { recursive: true });
        }
        if (createtransoutCheckbox.checked) {
            const today = document.getElementById('datePlaceholder1').textContent; // Gets today's date in YYYY-MM-DD format
            let transoutFolderPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\_ACCDIR_Defaults\\TransOut\\${today}`;
            if(selectedCreationType === "clientProject"){
                transoutFolderPath = `G:\\Shared drives\\ES Cloud\\_Clients\\_PDIR_Defaults\\_Standard\\TransOut\\${today}`;
            }
            await fs.promises.rmdir(transoutFolderPath, { recursive: true });
        }

   

        // Handle copying of TransIn directory based on checkbox state
        if (copyTransIn.checked) {
            const transInSourcePrimary = path.join('C:\\__Accounts\\__Clients', clientName, newProjectName, 'TransIn');
            const transInSourceSecondary = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName, newProjectName, 'TransIn');
            const transInDestinationC = path.join('C:\\_Clients', clientName, newProjectName, 'TransIn');

            try {
                // Check if the primary source exists
                await fs.promises.access(transInSourcePrimary);
                // Primary source exists, use it
                await fr.copy(transInSourcePrimary, transInDestinationC);
                console.log('TransIn files copied successfully to C Drive from primary source.');
            } catch (primaryError) {
                console.error('Primary source unavailable, trying secondary source:', primaryError);

                try {
                    // Check if the secondary source exists
                    await fs.promises.access(transInSourceSecondary);
                    // Secondary source exists, use it
                    await fr.copy(transInSourceSecondary, transInDestinationC);
                    console.log('TransIn files copied successfully to C Drive from secondary source.');
                } catch (secondaryError) {
                    console.error('Error copying TransIn files from both sources:', secondaryError);
                }
            }
            }

        if (copyToGDriveCheckbox.checked && copyTransIn.checked) {
            const transInSourcePrimary = path.join('C:\\__Accounts\\__Clients', clientName, newProjectName, 'TransIn');
            const transInSourceSecondary = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName, newProjectName, 'TransIn');
            const transInDestinationG = path.join(selected_drive, clientName, newProjectName, 'TransIn');

            try {
                await fs.promises.access(transInSourcePrimary);
                await fr.copy(transInSourcePrimary, transInDestinationG);
                console.log('TransIn files copied successfully to G Drive from primary source.');
            } catch (primaryError) {
                console.error('Primary source unavailable, trying secondary source:', primaryError);

                try {
                    await fs.promises.access(transInSourcePrimary);
                    await fr.copy(transInSourceSecondary, transInDestinationG);
                    console.log('TransIn files copied successfully to G Drive from secondary source.');
                } catch (secondaryError) {
                    console.error('Error copying TransIn files from both sources:', secondaryError);
                }
            }
        }
        if (copyOHS.checked) {
            const ohsSourcePrimary = path.join('C:\\__Accounts\\__Clients', clientName, newProjectName, 'OHS');
            const ohsSourceSecondary = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName, newProjectName, 'OHS');
            const ohsDestinationC = path.join('C:\\_Clients', clientName, newProjectName, 'OHS');

            try {
                await fs.promises.access(ohsSourceSecondary);
                await fr.copy(ohsSourcePrimary, ohsDestinationC);
                console.log('OHS files copied successfully to C Drive from primary source.');
            } catch (primaryError) {
                console.error('Primary source unavailable, trying secondary source:', primaryError);

                try {
                    await fs.promises.access(ohsSourceSecondary);
                    await fr.copy(ohsSourceSecondary, ohsDestinationC);
                    console.log('OHS files copied successfully to C Drive from secondary source.');
                } catch (secondaryError) {
                    console.error('Error copying OHS files from both sources:', secondaryError);
                }
            }
        }


        if (copyToGDriveCheckbox.checked && copyOHS.checked) {
            const ohsSourcePrimary = path.join('C:\\__Accounts\\__Clients', clientName, newProjectName, 'OHS');
            const ohsSourceSecondary = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients', clientName, newProjectName, 'OHS');
            const ohsDestinationG = path.join(selected_drive, clientName, newProjectName, 'OHS');

            try {
                await fs.promises.access(ohsSourcePrimary);
                await fr.copy(ohsSourcePrimary, ohsDestinationG);
                console.log('OHS files copied successfully to G Drive from primary source.');
            } catch (primaryError) {
                console.error('Primary source unavailable, trying secondary source:', primaryError);

                try {
                    await fs.promises.access(ohsSourceSecondary);
                    await fr.copy(ohsSourceSecondary, ohsDestinationG);
                    console.log('OHS files copied successfully to G Drive from secondary source.');
                } catch (secondaryError) {
                    console.error('Error copying OHS files from both sources:', secondaryError);
                }
            }
        }

            clearForm();
        } catch (error) {
            console.error('Error creating project:', error);
                        ipcRenderer.send('show-custom-alert', 'An error occurred while creating the project.');
        }
        if (clientName) {
            searchForClient(clientName, true);
    }
});

// Function to clear the form fields
function clearForm() {
    document.getElementById('clientInput1').value = ' ';
    document.getElementById('newProjectName').value = ' ';
    document.getElementById('createtransin').checked = false;
    document.getElementById('createtransout').checked = false;

}


// Additional logic to reset the form when the modal is closed
window.onclick = function(event) {
    const newProjectModal = document.getElementById('newProjectForm');
    const clientModal = document.getElementById('myModal');
    if (event.target === newProjectModal || event.target === clientModal) {
        newProjectModal.style.display = 'none';
        clientModal.style.display = 'none';
        document.getElementById('newProjectForm').reset();
    }
};

async function readAndProcessXmlConfig(filePath) {
    const xmlContent = await readExistingXmlConfig(filePath);
    if (!xmlContent) return [];

    try {
        const result = await parseStringPromise(xmlContent);
        console.log("Parsed XML: ", result); // Debug: Log parsed XML to verify structure

        const folderPairs = result.FreeFileSync.FolderPairs[0].Pair;
        return folderPairs.map(pair => {
            const left = pair.Left[0];
            const right = pair.Right[0];
            const differences = pair.Synchronize[0].Differences[0].$;
            
            console.log("Differences for pair: ", differences); // Debug: Log differences to verify values

            // Determine the variant based on the Differences attributes
            let variantSymbol = '';
            if (differences.RightNewer === 'left' && differences.RightOnly === 'left') {
                variantSymbol = '<>';  // Two-way
            } else if (differences.RightNewer === 'none' && differences.RightOnly === 'none') {
                variantSymbol = left.includes('C:\\') ? '>' : '<';  // Update
            }

            console.log("Variant Symbol: ", variantSymbol); // Debug: Log determined variant

            // Find which path is the C drive and which is the G drive
            const cDriveProject = left.includes('C:\\') ? left : right;
            const gDriveProject = left.includes('G:\\') ? left : right;

            return {
                cDriveProject,
                gDriveProject,
                variantSymbol
            };
        });
    } catch (error) {
        console.error('An error occurred while parsing the XML:', error);
        return [];
    }
}


document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
        console.log(event.target.value);

      if (event.target.value === 'quoteDirectory') {
            console.log("quoteDirectory clicked");

          // Update the headings for C Drive and G Drive
            document.getElementById('Heading').textContent = 'Existing Quotes:';
            document.getElementById('cDriveHeading').textContent = 'C Drive Quotes:';
            document.getElementById('gDriveHeading').textContent = 'G Drive Quotes:';
            document.getElementById("checkboxcopytransin").style.display = "none";
            document.getElementById("checkboxcopyohs").style.display = "none";
            document.getElementById('newProjectButton').textContent = 'Create New Quote';
            document.getElementById('newProjectNameid').textContent = 'New Quote Name';
            document.getElementById('copytransin').checked = false;
            document.getElementById('copyohs').checked = false;

        } else {
          // If not "quoteDirectory", revert to the original text or set to another desired text
            document.getElementById('Heading').textContent = 'Existing Projects:';
            document.getElementById('cDriveHeading').textContent = 'C Drive Projects:';
            document.getElementById('gDriveHeading').textContent = 'G Drive Projects:';
            document.getElementById("checkboxcopytransin").style.display = "none";
            document.getElementById("checkboxcopyohs").style.display = "none";

            document.getElementById('newProjectButton').textContent = 'Create New Project';
            document.getElementById('newProjectNameid').textContent = 'New Project Name';
            document.getElementById('copytransin').checked = false;
            document.getElementById('copyohs').checked = false;


        }

        const clientInput = document.getElementById('clientInput').value.trim();
        if (clientInput) {
            console.log("searchingForClient");
            searchForClient(clientInput, true);
        }
    });
});
//  function to populate projects and include empty rows for non-common projects
async function projectExists(directory, projectName) {
    try {
        const files = await fs.promises.readdir(directory);
        const exists = files.includes(projectName);
        return exists;
    } catch (err) {
        console.error(`Error accessing directory '${directory}':`, err);
        return false;
    }
}


// Updated populateProjects function, considering the selectedCreationType condition
// Assuming clientName is obtained elsewhere and passed as an argument
async function populateProjects(projectList, elementId, clientName) {

    console.log(clientName);
    const clientInput = document.getElementById("clientInput").value.trim();

    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    let enableCreateProject = selectedCreationType === 'quoteDirectory';

    const projectElement = document.getElementById(elementId);
    if (!projectElement) {
        console.error(`Element with ID '${elementId}' not found.`);
        return;
    }

    // Construct base paths for primary and secondary directories for both drives
    const basePathCPrimary = path.join('C:\\_Clients\\', clientInput);
    const basePathGPrimary = path.join(selected_drive, clientInput);
    const basePathCQuotes = path.join('C:\\__Accounts\\__Clients\\', clientInput);
    const basePathGQuotes = path.join('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\', clientInput);
    if (clientInput !== '' && clientName !== 'C:\\_Clients' && clientName !== selected_drive && clientName !== 'C:\\__Accounts\\__Clients' && clientName !== 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients') {
        const projectRows = await Promise.all(projectList.map(async (project) => {
            // Check existence in primary directories
            const existsInCPrimary = await projectExists(basePathCPrimary, project);
            const existsInGPrimary = await projectExists(basePathGPrimary, project);
            const existsInCQuotes = await projectExists(basePathCQuotes, project);
            const existsInGQuotes = await projectExists(basePathGQuotes, project);    

            // Decide on project action based on existence in primary directories
            if (existsInCPrimary || existsInGPrimary) {
                // Grey button appearance for disabled state
                projectActionHTML = `<td><button class = "copyProjectButton" style="font-size: 14px; color: white; background-color: grey; cursor: not-allowed; border: none; padding: 5px 10px;" disabled>Create Project</button></td>`;
                console.log(`Project '${project}' exists in primary directory. Rendering 'Create Project' button as disabled.`);
            } else if (!enableCreateProject) {
                // Grey button appearance for disabled state
                projectActionHTML = `<td><button class = "copyProjectButton" style="font-size: 14px; color: white; background-color: grey; cursor: not-allowed; border: none; padding: 5px 10px;" disabled>Create Project</button></td>`;
                console.log(`Creation of new projects is disabled.`);
            } else {
                // Blue button appearance for enabled state
                projectActionHTML = `<td><button class = "copyProjectButton" style="font-size: 14px; color: white; background-color: #3F51B5; cursor: pointer; border: none; padding: 5px 10px;" onclick="document.getElementById('copytransin').checked = true; document.getElementById('copyohs').checked = true; createProject('${project}')">Create Project</button></td>`;
                console.log(`Project '${project}' does not exist in primary directory. Rendering 'Create Project' button as active.`);
            }
            
            let copyButtonHTML = '';
            // Logic to enable copy button based on selected creation type and where the project exists
            if (selectedCreationType === 'clientProject' && (existsInCPrimary !== existsInGPrimary)) {
                // Handle client project copy logic
                let copyTo = existsInCPrimary ?  drive_symbol : 'C';
                let copyFromPath = existsInCPrimary ? basePathCPrimary : basePathGPrimary;
                let copyToPath = existsInCPrimary ? basePathGPrimary : basePathCPrimary;
                copyButtonHTML = generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo);
            } else if (selectedCreationType === 'quoteDirectory' && (existsInCQuotes !== existsInGQuotes)) {
                // Handle quote directory copy logic
                let copyTo = existsInCQuotes ? drive_symbol : 'C';
                let copyFromPath = existsInCQuotes ? basePathCQuotes : basePathGQuotes;
                let copyToPath = existsInCQuotes ? basePathGQuotes : basePathCQuotes;
                copyButtonHTML = generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo);
            }
            if (copyButtonHTML === '' ) {
                copyButtonHTML = `<td><button class="copyToButton" style="padding: 0;" ></button></td>`;
            }



            dataPath = path.join(clientName, project);
            if (dataPath.includes(basePathCPrimary) || dataPath.includes(basePathGPrimary)) {
                // If dataPath is a primary directory, reset projectActionHTML to avoid adding it
                projectActionHTML = '';
            }
            
            return `<tr>
                        <td>${project}</td>
                        <td><button class="open-folder-btn" data-path="${dataPath}">Open</button></td>
                        ${projectActionHTML}
                        ${copyButtonHTML}
                     </tr>`;
        }));
    
        projectElement.innerHTML = projectRows.join('');
        console.log(`Finished populating projects for element '${elementId}'.`);
    }
        
}
function generateCopyButtonHTML(project, copyFromPath, copyToPath, copyTo) {
    const safeCopyFromPath = copyFromPath.replace(/\\/g, '\\\\');
    const safeCopyToPath = copyToPath.replace(/\\/g, '\\\\');
    return `<td><button class="copyToButton" style="font-size: 14px; color: white; background-color: #4CAF50; cursor: pointer; border: none; padding: 5px 10px;" onclick="copyProject('${project}', '${safeCopyFromPath}', '${safeCopyToPath}')">Copy to ${copyTo}</button></td>`;
}
async function copyProject(projectName, fromPath, toPath) {
    const clientInput = document.getElementById("clientInput").value.trim();

    try {
        // Request the main process to show the copying progress window
        await ipcRenderer.invoke('show-copying-in-progress');

        // Request the main process to copy the directory
        await ipcRenderer.invoke('copy-directory', { projectName, fromPath, toPath });

        // Notify the main process to close the copying progress window
        await ipcRenderer.invoke('close-copying-in-progress');
        searchForClient(clientInput, true);

        console.log(`Project '${projectName}' has been successfully copied.`);

    } catch (error) {
        console.error(`Error copying project '${projectName}':`, error);
        // Ensure the copying progress window is closed even if an error occurs
        await ipcRenderer.invoke('close-copying-in-progress');
    }
}


function createProject(projectName) {

    console.log(`Creating project: ${projectName}`);

    document.getElementById("newProjectSection").style.display = "table-row";
    document.getElementById("newProjectButton").style.display = "none";
    document.getElementById("checkboxcopytransin").style.display = "block";
    document.getElementById("checkboxcopyohs").style.display = "block";
    document.getElementById('newProjectButton').textContent = 'Create New Project';

    clientName = document.getElementById("clientInput").value.trim();
    document.querySelectorAll('input[name="creationType"]').forEach((radio) => {
        if (radio.value === 'clientProject') {
            radio.checked = true;
            document.getElementById('projecttypes').style.display = "block";
            document.getElementById('newProjectName').value = projectName;
            const clientInput = document.getElementById('clientInput').value.trim();
            document.getElementById('Heading').textContent = 'Existing Projects:';
            document.getElementById('cDriveHeading').textContent = 'C Drive Projects:';
            document.getElementById('gDriveHeading').textContent = 'G Drive Projects:';
            if (clientInput) {
                console.log("searchingForClient");
                searchForClient(clientInput, true);
            }
        }
    });
}


document.getElementById('cDriveTable').addEventListener('click', (event) => {
    if (event.target.classList.contains('open-folder-btn')) {
        const projectPath = event.target.getAttribute('data-path');
        require('electron').shell.openPath(projectPath);
    }
});
document.getElementById('gDriveTable').addEventListener('click', (event) => {
    if (event.target.classList.contains('open-folder-btn')) {
        const projectPath = event.target.getAttribute('data-path');
        require('electron').shell.openPath(projectPath);
    }
});
function populateDirectionColumn(commonProjects, configData) {
    console.log(configData);
    const directionElement = document.getElementById('directionColumn');
    
    if (directionElement) {
        directionElement.innerHTML = commonProjects.map(projectName => {
            // Find if there is a folder pair config for this project
            const folderPair = configData.find(pair => 
                pair.cDriveProject.includes(projectName) || pair.gDriveProject.includes(projectName)
            );

            // Determine variant symbol and disable status
            let variantSymbol = folderPair ? folderPair.variantSymbol : '';
            let disabled = folderPair ? 'disabled' : '';

            // Map variant symbols to direction dropdown values
            let directionValue;
            switch (variantSymbol) {
                case '>': directionValue = 'Update Right'; break;
                case '<': directionValue = 'Update Left'; break;
                case '<>': directionValue = 'Update Both'; break;
                default: directionValue = ''; // Default value or placeholder if no config is found
            }

            // Render the dropdown menu with appropriate selected value and sync checkbox
            return `
                <div class="direction-cell" data-project-name="${projectName}">
                    <select class="direction-dropdown" ${disabled}>
                        <option value="Update Right" ${directionValue === 'Update Right' ? 'selected' : ''}>></option>
                        <option value="Update Left" ${directionValue === 'Update Left' ? 'selected' : ''}><</option>
                        <option value="Update Both" ${directionValue === 'Update Both' ? 'selected' : ''}><></option>
                    </select>
                    <label>
                        Sync <input type="checkbox" class="sync-checkbox" ${folderPair ? 'checked disabled' : ''}>
                    </label>
                </div>`;
        }).join('');
    }
}


function collectSyncSettings() {
    const projects = [];
    document.querySelectorAll('.direction-cell').forEach(cell => {
        const projectName = cell.getAttribute('data-project-name');
        const directionDropdown = cell.querySelector('.direction-dropdown');
        const syncCheckbox = cell.querySelector('.sync-checkbox');

        if (syncCheckbox.checked) {
            projects.push({
                name: projectName, // Correctly getting the project name from the attribute
                direction: directionDropdown.value,
                syncEnabled: true
            });
        }
    });
    return projects;
}
// Helper function to parse existing folder pairs into a set
function parseExistingPairsToSet(existingXml) {
    console.log(existingXml);
    const existingPairsSet = new Set();
    const pairRegex = /<Left>(.*?)<\/Left>\s*<Right>(.*?)<\/Right>/g;
    let match;

    while ((match = pairRegex.exec(existingXml)) !== null) {
        // Combine the paths to create a unique identifier for each pair
        existingPairsSet.add(`${match[1]}|${match[2]}`);
    }
   
    return existingPairsSet;
}
function generateFolderPairsXml(clientName, projects, existingPairsSet) {
    let folderPairsXml = '';
    clientName = clientName.replace(/&/g, '&amp;');

    console.log(projects);
    console.log(clientName);

    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    projects.forEach(project => {
        let leftPath;
        let rightPath;
        let differences;
        project.name = project.name.replace(/&/g, '&amp;');

        if (selectedCreationType === 'clientProject') {
            if (project.direction === 'Update Both') {
                rightPath = `${selected_drive}\\${clientName}\\${project.name}`;
                leftPath = `C:\\_Clients\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>';
            } else if (project.direction === 'Update Right') {
                leftPath = `C:\\_Clients\\${clientName}\\${project.name}`;
                rightPath = `${selected_drive}\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
            } else if (project.direction === 'Update Left') {
                leftPath = `${selected_drive}\\${clientName}\\${project.name}`;
                rightPath = `C:\\_Clients\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
            }
        } else if (selectedCreationType === 'quoteDirectory') {
            if (project.direction === 'Update Both') {
                leftPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                rightPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="left" RightOnly="left"/>';
            } else if (project.direction === 'Update Right') {
                leftPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                rightPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
            } else if (project.direction === 'Update Left') {
                leftPath = `G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                rightPath = `C:\\__Accounts\\__Clients\\${clientName}\\${project.name}`;
                differences = '<Differences LeftOnly="right" LeftNewer="right" RightNewer="none" RightOnly="none"/>';
            }
        }

        // Skip the folder pairs based on the selected drive
        if ((selected_drive === 'G:\\Shared drives\\ES Cloud\\_Clients' && (leftPath.includes('J:') || rightPath.includes('J:'))) ||
            (selected_drive === 'J:\\__Clients' && (leftPath.includes('G:') || rightPath.includes('G:')))) {
            return; // Skip this iteration
        }

        const pairIdentifier = `${leftPath}|${rightPath}`;
        console.log(pairIdentifier);
        // Check for duplicates
        if (!existingPairsSet.has(pairIdentifier)) {
            // If it's not a duplicate, add it to the XML string
            folderPairsXml += `
            <Pair>
                <Left>${leftPath}</Left>
                <Right>${rightPath}</Right>
                <Synchronize>
                    ${differences}
                    <DeletionPolicy>RecycleBin</DeletionPolicy>
                    <VersioningFolder Style="Replace"/>
                </Synchronize>
            </Pair>\n`;
        }
    });

    return folderPairsXml;
}


// Function to read the existing XML configuration
async function readExistingXmlConfig(filePath) {
    try {
        const xmlContent = await fs.promises.readFile(filePath, 'utf-8');
        return xmlContent;
    } catch (err) {
        // Handle error if the file does not exist
        console.error(err);
        return null; // Return null or appropriate default XML content
    }
}

function appendFolderPairsToExistingXml(existingXml, newFolderPairsXml) {
    // Find the index of the end of the <FolderPairs> opening tag
    const folderPairsStartIndex = existingXml.indexOf('<FolderPairs>');
    const folderPairsEndIndex = existingXml.indexOf('</FolderPairs>', folderPairsStartIndex);

    if (folderPairsStartIndex !== -1 && folderPairsEndIndex !== -1) {
        // Insert the new folder pairs before the closing tag of <FolderPairs>
        return existingXml.substring(0, folderPairsEndIndex) + 
               newFolderPairsXml + 
               existingXml.substring(folderPairsEndIndex);
    } else {
        // If the <FolderPairs> tags are not found, just return the existing XML
        return existingXml;
    }
}

document.addEventListener("DOMContentLoaded", function() {
    const client = algoliasearch('ENGDR4U6W2', '22d7addd0f220bff6a0f83b8a7f4e287');
    const clientIndex = client.initIndex('clients');
    const TenderIndex = client.initIndex('Tenders');
    const contactIndex = client.initIndex('contacts');

    const clientInput = document.getElementById("clientInput");
    const clientDropdown = document.getElementById("clientDropdown");

    clientInput.addEventListener("input", function() {
        const query = this.value;

        if (query.length >= 2) {
            clientIndex.search(query, { hitsPerPage: 30 })
                .then(({ hits }) => {
                    let dropdownContent = "<ul>";
                    hits.forEach(hit => {
                        dropdownContent += `<li>${hit.reference}</li>`; // Adjust according to your data structure
                    });
                    dropdownContent += "</ul>";
                    clientDropdown.innerHTML = dropdownContent;
                })
                .catch(err => {
                    console.error("Algolia search error: ", err);
                });
        } else {
            clientDropdown.innerHTML = "";
        }
    });


    clientDropdown.addEventListener("click", function(e) {
        if (e.target.tagName === 'LI') {
            clientInput.value = e.target.textContent;
            clientDropdown.innerHTML = "";
        }
    });

    
    const newProjectName = document.getElementById("newProjectName");
    const newProjectNameDropdown = document.getElementById("newProjectNameDropdown");

    newProjectName.addEventListener("input", function() {
        const query = this.value;

        if (query.length >= 2) {
            TenderIndex.search(query, { hitsPerPage: 30 })
                .then(({ hits }) => {
                    let dropdownContent = "<ul>";
                    hits.forEach(hit => {
                        // Create a list item with the reference, name, and client_name
                        dropdownContent += `<li data-reference="${hit.reference}_${hit.name}">${hit.reference} ${hit.name} (${hit.client_name})</li>`;
                    });
                    dropdownContent += "</ul>";
                    newProjectNameDropdown.innerHTML = dropdownContent;
                })
                .catch(err => {
                    console.error("Algolia search error: ", err);
                });
        } else {
            newProjectNameDropdown.innerHTML = "";
        }
    });

    newProjectNameDropdown.addEventListener("click", function(e) {
        if (e.target.tagName === 'LI') {
            // Extract the reference from the data-reference attribute
            const selectedReference = e.target.getAttribute('data-reference');
            newProjectName.value = selectedReference; // Set the input value to the selected reference
            newProjectNameDropdown.innerHTML = "";
        }
    });
    const contactInput = document.getElementById("linkedContact");
    const contactDropdown = document.getElementById("contactDropdown");

    contactInput.addEventListener("input", function() {
        const query = this.value;
    
        if (query.length >= 2) {
            contactIndex.search(query, { hitsPerPage: 10 })
                .then(({ hits }) => {
                    let dropdownContent = "<ul>";
                    hits.forEach(hit => {
                        dropdownContent += `<li data-reference="${hit.name} "data-value="${hit.value}">
                                                <span class="name">${hit.name}</span><br>
                                                <span class="email">${hit.email}</span><br>
                                                <span class="phone">${hit.phone}</span>
                                            </li>`;
                    });
                    dropdownContent += "</ul>";
                    contactDropdown.innerHTML = dropdownContent;
                })
                .catch(err => {
                    console.error("Algolia search error: ", err);
                });
        } else {
            contactDropdown.innerHTML = "";
        }
    });
    contactDropdown.addEventListener("click", function(e) {
                
            // Ensure that the click is on an li element
            if (e.target.tagName === 'LI') {
                // Assume the contact details are within the text content and separated by newlines or other delimiters
                // You may need to adapt this logic to match the exact format of your li elements
                const details = e.target.textContent.split('\n');
                const contactId = e.target.getAttribute('data-value'); // Capture the contact ID
                const contactName = details[1];
                const contactEmail = details[2];
                const contactPhone = details[3];
                contactDropdown.innerHTML = "";
                contactInput.value = ""; 
                document.getElementById('contactId').value = contactId;

                // Populate the input fields with the selected contact details
                document.getElementById('contactName').value = contactName.trim();
                document.getElementById('emailAddress').value = contactEmail.trim();
                document.getElementById('phoneNumber').value = contactPhone.trim();
            }
    });
    
    
    
// ----------------------------------- existing projects code--------------------------------
const searchButton = document.getElementById("searchButton");
    searchButton.addEventListener("click", function() {
        const clientName = document.getElementById("clientInput").value;
        if (clientName) {
            searchForClient(clientName, false);
        }
    });

document.querySelectorAll('input[name="creationType"]').forEach(radio => {
    radio.addEventListener('change', async (event) => {
        
        if (event.target.value === 'clientProject') {
            // When "Client Project" is selected, read the directories
            document.getElementById('projecttypes').style.display = "block";


            try {
                const cDriveProjects = await readProjectsFromDirectory('C:\\_Clients');
                const gDriveProjects = await readProjectsFromDirectory(selected_drive);

                let cpath = 'C:\\_Clients'
                let gpath = selected_drive
                // Populate the Existing Projects section
                populateProjects(cDriveProjects, 'cDriveProjects', cpath);
                populateProjects(gDriveProjects, 'gDriveProjects', gpath);
            } catch (err) {
                console.error("Error reading directories: ", err);
            }
           

        }
        if (event.target.value === 'quoteDirectory') {
            // When "Client Project" is selected, read the directories
            document.getElementById('projecttypes').style.display = "none";

            try {
                const cDriveProjects = await readProjectsFromDirectory('C:\\__Accounts\\__Clients');
                const gDriveProjects = await readProjectsFromDirectory('G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients');
                console.log("C Drive Quotes:", cDriveProjects);
                                console.log("G Drive Quotes:", gDriveProjects);
                
                // Populate the Existing Projects section
                populateProjects(cDriveProjects, 'cDriveProjects','C:\\__Accounts\\__Clients');
                populateProjects(gDriveProjects, 'gDriveProjects', 'G:\\Shared drives\\Accounts QT\\__Accounts\\__Clients');
            } catch (err) {
                console.error("Error reading directories: ", err);
            }

        }
    }); 
});
    



        
//event listner to open the new project 
document.getElementById("newProjectButton").addEventListener("click", function() {
    document.getElementById("newProjectSection").style.display = "table-row";
    document.getElementById("newProjectButton").style.display = "none";

    
});

document.getElementById("hideNewProjectSectionButton").addEventListener("click", function() {
    document.getElementById("newProjectSection").style.display = "none";
    document.getElementById("newProjectButton").style.display = "table-row";

});
// Event listener for the Run Sync button
document.getElementById('runSyncButton').addEventListener('click', async () => {

    
        
    // Make sure client name is provided
    const clientName = document.getElementById('clientInput').value.trim();
    if (!clientName) {
        ipcRenderer.send('show-custom-alert', 'Please enter a client name');

        return;
    }

    // Collect sync settings from the UI
    const projects = collectSyncSettings();
    // Check if there are any projects to sync
    if (projects.length === 0) {
        
        ipcRenderer.send('show-custom-alert', 'No projects selected for synchronization');

        return;
    }
    const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;
    let existingXmlConfig='';

    // Save the updated XML configuration back to the file
    if (selectedCreationType === 'clientProject') {
        if (selected_drive == 'J:\\__Clients') {
            existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettingsJdrive.ffs_gui');
        }
        else {
            existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettings.ffs_gui');
        }
    }
    else 
        {
            existingXmlConfig = await readExistingXmlConfig('C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui');
        }
    // Read the existing XML configuration

    // Parse existing pairs into a set
    const existingPairsSet = parseExistingPairsToSet(existingXmlConfig || '');
    console.log(existingPairsSet);


    // Generate folder pairs XML from sync settings, passing the existing pairs set
    const folderPairsXml = generateFolderPairsXml(clientName, projects, existingPairsSet);

    // Append the new folder pairs to the existing XML
    const updatedXmlConfig = existingXmlConfig ? appendFolderPairsToExistingXml(existingXmlConfig, folderPairsXml) : createFullXmlConfig(folderPairsXml); // Handle the case where existingXmlConfig is null

    // Save the updated XML configuration back to the file
    let xmlConfigPath = '';
    if (selectedCreationType === 'clientProject') {
        if(selected_drive == 'J:\\__Clients')
        {
            xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettingsJdrive.ffs_gui';
        }
        else{
            xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettings.ffs_gui';
        }

    }
    else 
        {
            xmlConfigPath = 'C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui';
        }

    try {
        
        await fs.promises.writeFile(xmlConfigPath, updatedXmlConfig, 'utf-8');
        ipcRenderer.send('show-custom-alert', 'Folder Pairs have been created.');

    } catch (error) {
        console.error('Failed to write XML configuration or execute sync:', error);
        ipcRenderer.send('show-custom-alert', 'An error occurred while setting up the synchronization.');

    }
     // Reset the dropdowns to their default value
    const directionDropdowns = document.querySelectorAll('.direction-dropdown');
    directionDropdowns.forEach(dropdown => {
        dropdown.value = 'Update Both'; // Assuming 'Update Both' is the default value
    });

    // Uncheck all checkboxes
    const syncCheckboxes = document.querySelectorAll('.sync-checkbox');
    syncCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    if (clientName) {
        searchForClient(clientName, true);
    }
});
    document.getElementById("openfile").addEventListener('click', async () => {
        
        const selectedCreationType = document.querySelector('input[name="creationType"]:checked').value;

        let result;
        if (selectedCreationType === 'clientProject') {
            if (selected_drive == 'J:\\__Clients') {
                result = await shell.openPath('C:\\Freefilesyncfiles\\SyncSettingsJdrive.ffs_gui');
            }
            else {
                result = await shell.openPath('C:\\Freefilesyncfiles\\SyncSettings.ffs_gui');

            }
        }
        else 
            {
                result = await shell.openPath('C:\\Freefilesyncfiles\\SyncSettings_Quotes.ffs_gui');

           }
        if (result) {
            console.error('Failed to open file:', result);
            ipcRenderer.send('show-custom-alert', 'An error occurred while opening the file.');
        }
     });

    document.getElementById("refresh").addEventListener("click", function () {
        
        if (document.getElementById("clientInput").value === '') {
            console.log('refreshed');
        }
        else
        {
            searchForClient(document.getElementById("clientInput").value, true);
        }
    });
    

});
