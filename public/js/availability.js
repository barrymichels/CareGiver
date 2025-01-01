document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('saveAvailability');
    const availabilityToggles = document.querySelectorAll('input[name="availability"]');

    availabilityToggles.forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const status = e.target.closest('.slot-toggle').querySelector('.slot-status');
            const isAvailable = e.target.checked;
            status.textContent = isAvailable ? 'Available' : 'Unavailable';
            status.dataset.available = isAvailable;
        });
    });

    saveButton.addEventListener('click', async () => {
        const availability = [];
        availabilityToggles.forEach(toggle => {
            availability.push({
                date: toggle.dataset.date,
                time: toggle.dataset.time,
                isAvailable: toggle.checked
            });
        });

        try {
            const response = await fetch('/availability/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    availability
                }),
            });

            if (response.ok) {
                showMessage('Availability updated successfully', 'success');
            } else {
                showMessage('Failed to update availability', 'error');
            }
        } catch (error) {
            showMessage('An error occurred', 'error');
        }
    });

    function showMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        
        const container = document.querySelector('.availability-section');
        container.insertBefore(messageDiv, container.firstChild);
        
        setTimeout(() => messageDiv.remove(), 3000);
    }
}); 