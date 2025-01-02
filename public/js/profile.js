document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('profile-form');
    const passwordForm = document.getElementById('password-form');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const passwordModal = document.getElementById('passwordModal');
    const closeModalBtn = document.querySelector('.close-modal');

    // Profile form submission
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(profileForm);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch('/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                showToast('Profile updated successfully', 'success');
            } else {
                const responseData = await response.json();
                showToast(responseData.error || 'Failed to update profile', 'error');
            }
        } catch (error) {
            showToast('An error occurred', 'error');
        }
    });

    // Password form submission
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(passwordForm);
        const data = Object.fromEntries(formData);

        if (data.newPassword !== data.confirmPassword) {
            showToast('Passwords do not match', 'error');
            return;
        }

        try {
            const response = await fetch('/profile/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    currentPassword: data.currentPassword,
                    newPassword: data.newPassword,
                    confirmPassword: data.confirmPassword
                }),
            });

            if (response.ok) {
                showToast('Password updated successfully', 'success');
                passwordForm.reset();
                passwordModal.classList.remove('active');
            } else {
                const responseData = await response.json();
                showToast(responseData.error || 'Failed to update password', 'error');
            }
        } catch (error) {
            showToast('An error occurred', 'error');
        }
    });

    // Modal handling
    changePasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
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

    // Toast notification function
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Remove toast after animation
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}); 