document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('saveAvailability');
    const availabilityContainer = document.querySelector('.availability-section');
    
    // Only run availability code if we're on a page with the availability section
    if (availabilityContainer) {
        const checkboxes = availabilityContainer.querySelectorAll('input[type="checkbox"]');
        let isDirty = false;

        // Disable save button initially
        if (saveButton) {
            saveButton.disabled = true;

            saveButton.addEventListener('click', async () => {
                const availability = [];
                checkboxes.forEach(checkbox => {
                    availability.push({
                        date: checkbox.dataset.date,
                        time: checkbox.dataset.time,
                        isAvailable: checkbox.checked
                    });
                });

                try {
                    const response = await fetch('/availability/update', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ availability }),
                    });

                    if (response.ok) {
                        isDirty = false;
                        saveButton.disabled = true;
                        showToast('Availability saved successfully');
                    } else {
                        showToast('Failed to save availability', 'error');
                    }
                } catch (error) {
                    console.error('Error saving availability:', error);
                    showToast('An error occurred while saving', 'error');
                }
            });
        }

        // Track changes to checkboxes
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                isDirty = true;
                if (saveButton) saveButton.disabled = false;
                
                // Update status text
                const statusSpan = checkbox.parentElement.querySelector('.slot-status');
                if (statusSpan) {
                    statusSpan.textContent = checkbox.checked ? 'Available' : 'Unavailable';
                    statusSpan.dataset.available = checkbox.checked;
                }
            });
        });

        // Handle navigation within the app
        document.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (e) => {
                if (isDirty) {
                    e.preventDefault();
                    showUnsavedChangesModal(e.currentTarget.href);
                }
            });
        });

        // Handle browser back/forward buttons and direct URL changes
        window.addEventListener('popstate', (e) => {
            if (isDirty) {
                e.preventDefault();
                showUnsavedChangesModal(window.location.href);
                // Prevent the default navigation
                history.pushState(null, '', window.location.href);
            }
        });
    }
});

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showUnsavedChangesModal(targetHref) {
    const modal = document.getElementById('unsavedChangesModal');
    if (!modal) return;

    modal.style.display = 'flex';
    
    const stayButton = document.getElementById('stayButton');
    const leaveButton = document.getElementById('leaveButton');
    
    if (stayButton) {
        stayButton.onclick = () => {
            modal.style.display = 'none';
        };
    }
    
    if (leaveButton) {
        leaveButton.onclick = () => {
            isDirty = false; // Clear the dirty flag before navigating
            window.location.href = targetHref;
        };
    }
} 