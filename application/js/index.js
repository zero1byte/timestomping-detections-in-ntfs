const SERVER_URL = 'http://localhost:3000';

// list of drive data fetched from the server
async function fetchData() {
    console.log('Fetching data from server...');
    try {
        const response = await fetch(`${SERVER_URL}/drives`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return { data, iserror: false };
    }
    catch (error) {
        console.error('Error fetching data:', error);
        return { data: null, iserror: true };
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const data = await fetchData();
    if (data.iserror) {
        alert('Failed to fetch drive data from the server. Please try again later.');
        return;
    }
    // Initialize the drive selection dropdown
    const driveSelect = document.getElementById('driveSelect');
    data.data.drives.forEach(drive => {
        if (drive.fstype === 'NTFS') {
            driveSelect.innerHTML += `<option value="${drive.drive}">${drive.drive}     (${drive.total_gb} ${drive.fstype})</option>`;
        }
    });
});

// Handle form submission
document.getElementById('submitLiveDisk').addEventListener('click', async () => {
    const driveSelect = document.getElementById('driveSelect');
    const selectedDrive = driveSelect.value;
    if (!selectedDrive) {
        alert('Please select a drive to analyze.');
        return;
    }
    try {
        const response = await fetch(`${SERVER_URL}/disk/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ drive: selectedDrive })
        });
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const result = await response.json();
        alert(`Analysis complete for drive ${selectedDrive}.\nResults:\n${JSON.stringify(result, null, 2)}`);
    }
    catch (error) {
        console.error('Error during analysis:', error);
        alert('Failed to analyze the selected drive. Please try again later.');
    }
});