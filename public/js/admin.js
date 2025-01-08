document.addEventListener('DOMContentLoaded', function() {
    // Modal handling
    const virtualUserModal = document.getElementById('virtualUserModal');
    const convertUserModal = document.getElementById('convertUserModal');
    const addVirtualUserBtn = document.getElementById('addVirtualUser');
    const virtualUserForm = document.getElementById('virtualUserForm');
    const convertUserForm = document.getElementById('convertUserForm');

    function showModal(modalId) {
        document.getElementById(modalId).classList.add('show');
    }

    function closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
        if (modalId === 'virtualUserModal') {
            virtualUserForm.reset();
        } else if (modalId === 'convertUserModal') {
            convertUserForm.reset();
        }
    }

    // Show modal when clicking Add Virtual User button
    addVirtualUserBtn?.addEventListener('click', () => showModal('virtualUserModal'));

    // Close modals when clicking outside
    [virtualUserModal, convertUserModal].forEach(modal => {
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });

    // Handle virtual user form submission
    virtualUserForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim()
        };

        try {
            const response = await fetch('/admin/users/virtual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                showToast('Virtual user added successfully');
                closeModal('virtualUserModal');
                window.location.reload();
            } else {
                showToast(data.error || 'Error adding virtual user', 'error');
            }
        } catch (error) {
            showToast('Error adding virtual user', 'error');
        }
    });

    // Handle convert to real user
    document.querySelectorAll('.convert-button').forEach(button => {
        button.addEventListener('click', () => {
            const userId = button.dataset.userId;
            const firstName = button.dataset.firstName;
            const lastName = button.dataset.lastName;
            
            // Set user name in modal
            const nameElement = convertUserModal.querySelector('.convert-user-name');
            nameElement.textContent = `Converting ${firstName} ${lastName} to a real user`;
            
            // Store userId in form for submission
            convertUserForm.dataset.userId = userId;
            
            showModal('convertUserModal');
        });
    });

    // Handle convert user form submission
    convertUserForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const userId = e.target.dataset.userId;
        const email = document.getElementById('email').value.trim();

        try {
            const response = await fetch(`/admin/users/${userId}/convert`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (response.ok) {
                showToast('User converted successfully');
                closeModal('convertUserModal');
                window.location.reload();
            } else {
                showToast(data.error || 'Error converting user', 'error');
            }
        } catch (error) {
            showToast('Error converting user', 'error');
        }
    });

    // Toast notification
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Handle user toggles (existing code)
    document.querySelectorAll('.active-toggle, .admin-toggle').forEach(toggle => {
        toggle.addEventListener('change', async function() {
            const userId = this.dataset.userId;
            const isAdmin = this.classList.contains('admin-toggle');
            const isActive = this.checked;

            try {
                const response = await fetch(`/admin/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        [isAdmin ? 'is_admin' : 'is_active']: isActive
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    showToast('User updated successfully');
                } else {
                    showToast(data.error || 'Error updating user', 'error');
                    // Revert toggle if update failed
                    this.checked = !isActive;
                }
            } catch (error) {
                showToast('Error updating user', 'error');
                // Revert toggle if update failed
                this.checked = !isActive;
            }
        });
    });
}); 