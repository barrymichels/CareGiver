document.addEventListener('DOMContentLoaded', () => {
    const setupForm = document.getElementById('setup-form');
    const password = setupForm.querySelector('input[name="password"]');
    const confirmPassword = setupForm.querySelector('input[name="confirmPassword"]');

    // Add password match validation
    confirmPassword.addEventListener('input', () => {
        if (password.value !== confirmPassword.value) {
            confirmPassword.setCustomValidity('Passwords do not match');
        } else {
            confirmPassword.setCustomValidity('');
        }
    });

    password.addEventListener('input', () => {
        if (password.value !== confirmPassword.value) {
            confirmPassword.setCustomValidity('Passwords do not match');
        } else {
            confirmPassword.setCustomValidity('');
        }
    });

    // Handle form submission
    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(setupForm);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch(setupForm.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const responseData = await response.json();
            
            if (response.ok) {
                showMessage(setupForm, responseData.message, 'success');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else {
                showMessage(setupForm, responseData.error, 'error');
            }
        } catch (error) {
            showMessage(setupForm, 'An error occurred. Please try again.', 'error');
        }
    });

    const showMessage = (form, message, type) => {
        // Remove any existing message
        const existingMessage = form.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Create and insert new message
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        form.insertBefore(messageDiv, form.firstChild);

        // Remove message after 5 seconds
        setTimeout(() => messageDiv.remove(), 5000);
    };
}); 