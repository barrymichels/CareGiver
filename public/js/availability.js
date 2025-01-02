document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('saveAvailability');
    let isDirty = false;

    // Disable save button initially
    saveButton.disabled = true;

    // Track changes to any checkbox
    document.querySelectorAll('.availability-slot input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            // Update the status display
            const status = e.target.closest('.slot-toggle').querySelector('.slot-status');
            const isAvailable = e.target.checked;
            status.textContent = isAvailable ? 'Available' : 'Unavailable';
            status.dataset.available = isAvailable;

            // Track changes
            isDirty = true;
            saveButton.disabled = false;
        });
    });

    saveButton.addEventListener('click', async () => {
        try {
            const availability = [];
            document.querySelectorAll('.availability-slot input[type="checkbox"]').forEach(checkbox => {
                availability.push({
                    date: checkbox.dataset.date,
                    time: checkbox.dataset.time,
                    isAvailable: checkbox.checked
                });
            });

            const response = await fetch('/availability/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ availability })
            });

            if (!response.ok) {
                throw new Error('Failed to save availability');
            }

            // On successful save
            isDirty = false;
            saveButton.disabled = true;
            
            // Show success message
            const toast = document.createElement('div');
            toast.className = 'toast success';
            toast.textContent = 'Availability saved successfully';
            document.body.appendChild(toast);
            
            // Remove toast after 3 seconds
            setTimeout(() => {
                toast.remove();
            }, 3000);

        } catch (error) {
            console.error('Error saving availability:', error);
            // Show error message
            const toast = document.createElement('div');
            toast.className = 'toast error';
            toast.textContent = 'Failed to save availability';
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.remove();
            }, 3000);
        }
    });

    // Handle page navigation
    window.addEventListener('beforeunload', (e) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Handle navigation within the app
    document.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            if (isDirty) {
                e.preventDefault();
                const targetHref = e.currentTarget.href;
                const modal = document.getElementById('unsavedChangesModal');
                modal.style.display = 'flex';
                
                document.getElementById('stayButton').onclick = () => {
                    modal.style.display = 'none';
                };
                
                document.getElementById('leaveButton').onclick = () => {
                    isDirty = false;
                    window.location.href = targetHref;
                };
            }
        });
    });
}); 