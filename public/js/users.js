document.addEventListener('DOMContentLoaded', () => {
    const userRows = document.querySelectorAll('.user-row[data-user-id]');

    userRows.forEach(row => {
        const userId = row.dataset.userId;
        const toggleStatus = row.querySelector('.toggle-status');
        const toggleRole = row.querySelector('.toggle-role');

        toggleStatus?.addEventListener('click', async () => {
            const isCurrentlyActive = toggleStatus.dataset.active === 'true';
            const isCurrentlyAdmin = toggleRole.dataset.admin === 'true';
            try {
                const response = await fetch(`/users/update/${userId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        is_active: !isCurrentlyActive,
                        is_admin: isCurrentlyAdmin === true
                    }),
                });

                if (response.ok) {
                    location.reload();
                } else {
                    const data = await response.json();
                    alert(data.error || 'Failed to update user');
                }
            } catch (error) {
                alert('An error occurred');
            }
        });

        toggleRole?.addEventListener('click', async () => {
            const isCurrentlyActive = toggleStatus.dataset.active === 'true';
            const isCurrentlyAdmin = toggleRole.dataset.admin === 'true';
            try {
                const response = await fetch(`/users/update/${userId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        is_active: isCurrentlyActive === true,
                        is_admin: !isCurrentlyAdmin
                    }),
                });

                if (response.ok) {
                    location.reload();
                } else {
                    const data = await response.json();
                    alert(data.error || 'Failed to update user');
                }
            } catch (error) {
                alert('An error occurred');
            }
        });
    });
}); 