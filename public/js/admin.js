document.addEventListener('DOMContentLoaded', () => {
    const userList = document.querySelector('.user-list');
    
    if (userList) {
        userList.addEventListener('change', async (e) => {
            const toggle = e.target;
            if (!toggle.matches('.active-toggle, .admin-toggle')) return;

            const userId = toggle.dataset.userId;
            const isActive = toggle.classList.contains('active-toggle');
            const isAdmin = toggle.classList.contains('admin-toggle');
            const newValue = toggle.checked;

            try {
                const response = await fetch(`/admin/users/${userId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        [isActive ? 'is_active' : 'is_admin']: newValue
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to update user');
                }

                showToast(`User ${isActive ? 'activation' : 'admin status'} updated successfully`);
            } catch (error) {
                console.error('Error updating user:', error);
                toggle.checked = !newValue; // Revert the toggle
                showToast('Failed to update user', 'error');
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