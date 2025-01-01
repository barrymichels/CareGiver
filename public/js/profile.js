document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('profileForm');
    const passwordForm = document.getElementById('passwordForm');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const passwordModal = document.getElementById('passwordModal');
    const closeModalBtn = document.querySelector('.close-modal');

    // Profile form submission
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(profileForm);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch('/profile/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const responseData = await response.json();

            if (response.ok) {
                showMessage(profileForm, responseData.message, 'success');
            } else {
                showMessage(profileForm, responseData.error, 'error');
            }
        } catch (error) {
            showMessage(profileForm, 'An error occurred', 'error');
        }
    });

    // Password form submission
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(passwordForm);
        const data = Object.fromEntries(formData);

        if (data.newPassword !== data.confirmPassword) {
            showMessage(passwordForm, 'Passwords do not match', 'error');
            return;
        }

        try {
            const response = await fetch('/profile/password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    currentPassword: data.currentPassword,
                    newPassword: data.newPassword,
                }),
            });

            const responseData = await response.json();

            if (response.ok) {
                showMessage(passwordForm, responseData.message, 'success');
                passwordForm.reset();
                setTimeout(() => {
                    passwordModal.classList.remove('active');
                }, 2000);
            } else {
                showMessage(passwordForm, responseData.error, 'error');
            }
        } catch (error) {
            showMessage(passwordForm, 'An error occurred', 'error');
        }
    });

    // Modal handling
    changePasswordBtn.addEventListener('click', () => {
        passwordModal.classList.add('active');
    });

    closeModalBtn.addEventListener('click', () => {
        passwordModal.classList.remove('active');
        passwordForm.reset();
    });

    passwordModal.addEventListener('click', (e) => {
        if (e.target === passwordModal) {
            passwordModal.classList.remove('active');
            passwordForm.reset();
        }
    });

    function showMessage(form, message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        
        const existingMessage = form.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }
        
        form.insertBefore(messageDiv, form.firstChild);
        setTimeout(() => messageDiv.remove(), 5000);
    }
}); 