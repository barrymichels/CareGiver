document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.delete-user').forEach(button => {
        button.addEventListener('click', async () => {
            if (!confirm(`Permanently delete ${button.dataset.userName}? Their availability, assignments, and notification settings will be removed. Shared schedules and templates will be kept. This cannot be undone.`)) return;

            const row = button.closest('.user-card, .user-row');
            const controls = row.querySelectorAll('button, input');
            controls.forEach(control => { control.disabled = true; });
            try {
                const response = await fetch(`/admin/users/${button.dataset.userId}`, { method: 'DELETE' });
                if (response.ok) {
                    row.remove();
                } else {
                    const data = await response.json();
                    alert(data.error || 'Failed to delete user');
                }
            } catch (error) {
                alert('Failed to delete user. Please try again.');
            } finally {
                controls.forEach(control => { control.disabled = false; });
            }
        });
    });
});
