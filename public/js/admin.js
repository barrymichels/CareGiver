document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('saveSchedule');
    const radioButtons = document.querySelectorAll('input[type="radio"]');
    const filterButtons = document.querySelectorAll('.user-filter-btn');
    const slotCounts = new Map(); // Track slot counts per user
    let isDirty = false;

    // Disable save button initially
    saveButton.disabled = true;

    // Track changes to radio buttons instead of assignment-select
    radioButtons.forEach(radio => {
        radio.addEventListener('change', () => {
            isDirty = true;
            saveButton.disabled = false;
        });
    });

    // Update slot counts
    function updateSlotCounts() {
        slotCounts.clear();
        radioButtons.forEach(radio => {
            if (radio.checked && radio.value) {
                const userId = radio.value;
                slotCounts.set(userId, (slotCounts.get(userId) || 0) + 1);
            }
        });

        // Update count displays
        filterButtons.forEach(btn => {
            const userId = btn.dataset.userId;
            const countSpan = btn.querySelector('.slot-count');
            if (userId && countSpan) {
                countSpan.textContent = slotCounts.get(userId) || 0;
            }
        });
    }

    // Initialize counts
    updateSlotCounts();

    // Handle radio button changes
    radioButtons.forEach(radio => {
        radio.addEventListener('change', () => {
            updateSlotCounts();

            // Get currently active filter
            const activeFilter = document.querySelector('.user-filter-btn.active');
            if (!activeFilter) return;

            // Clear existing highlights
            document.querySelectorAll('.user-option').forEach(option => {
                option.classList.remove('highlighted');
            });

            const userId = activeFilter.dataset.userId;
            const isUnassignedFilter = activeFilter.dataset.filter === 'unassigned';

            // Reapply highlighting based on active filter
            document.querySelectorAll('.user-option').forEach(option => {
                const optionRadio = option.querySelector('input[type="radio"]');
                if (optionRadio) {
                    if (isUnassignedFilter) {
                        if (optionRadio.value === '' && optionRadio.checked) {
                            option.classList.add('highlighted');
                        }
                    } else if (userId && optionRadio.checked && optionRadio.value === userId) {
                        option.classList.add('highlighted');
                    }
                }
            });
        });
    });

    // Handle filter clicks
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Clear all highlights first
            document.querySelectorAll('.user-option').forEach(option => {
                option.classList.remove('highlighted');
            });

            // Toggle active state of clicked button
            btn.classList.toggle('active');

            // If button is not active after toggle, we're done
            if (!btn.classList.contains('active')) {
                return;
            }

            // Deactivate other buttons
            filterButtons.forEach(otherBtn => {
                if (otherBtn !== btn) {
                    otherBtn.classList.remove('active');
                }
            });

            const userId = btn.dataset.userId;
            const isUnassignedFilter = btn.dataset.filter === 'unassigned';
            
            // Handle highlighting
            document.querySelectorAll('.user-option').forEach(option => {
                const radio = option.querySelector('input[type="radio"]');
                if (radio) {
                    if (isUnassignedFilter) {
                        // Highlight unassigned slots
                        if (radio.value === '' && radio.checked) {
                            option.classList.add('highlighted');
                        }
                    } else if (userId && radio.checked && radio.value === userId) {
                        // Highlight selected user's assignments
                        option.classList.add('highlighted');
                    }
                }
            });
        });
    });

    // Handle save button click
    saveButton.addEventListener('click', async () => {
        const assignments = [];
        radioButtons.forEach(radio => {
            if (radio.checked && radio.value && radio.dataset.date) {
                assignments.push({
                    userId: parseInt(radio.value),
                    date: radio.dataset.date,
                    time: radio.dataset.time
                });
            }
        });

        try {
            const response = await fetch('/admin/assign', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ assignments }),
            });

            if (response.ok) {
                // On successful save
                isDirty = false;
                saveButton.disabled = true;
                updateSlotCounts(); // Update counts after save
                
                // Show success message
                const toast = document.createElement('div');
                toast.className = 'toast success';
                toast.textContent = 'Schedule saved successfully';
                document.body.appendChild(toast);
                
                // Remove toast after 3 seconds
                setTimeout(() => {
                    toast.remove();
                }, 3000);
            } else {
                // Show error message
                const toast = document.createElement('div');
                toast.className = 'toast error';
                toast.textContent = 'Failed to save schedule';
                document.body.appendChild(toast);
                
                setTimeout(() => {
                    toast.remove();
                }, 3000);
            }
        } catch (error) {
            console.error('Error saving schedule:', error);
            // Show error message
            const toast = document.createElement('div');
            toast.className = 'toast error';
            toast.textContent = 'An error occurred while saving';
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.remove();
            }, 3000);
        }
    });

    function showMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        
        const container = document.querySelector('.schedule-manager');
        container.insertBefore(messageDiv, container.firstChild);
        
        setTimeout(() => messageDiv.remove(), 3000);
    }

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

    const userList = document.querySelector('.user-list');

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

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}); 