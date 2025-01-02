document.addEventListener('DOMContentLoaded', () => {
    // Get elements
    const saveButton = document.getElementById('saveSchedule');
    const scheduleContainer = document.querySelector('.schedule-grid');
    
    // Only run schedule management code if we're on the schedule page
    if (scheduleContainer) {
        const radioButtons = document.querySelectorAll('input[type="radio"]');
        const filterButtons = document.querySelectorAll('.user-filter-btn');
        const slotCounts = new Map(); // Track slot counts per user
        let isDirty = false;

        // Initialize counts
        updateSlotCounts();

        // Trigger the unassigned filter by default
        const unassignedFilterBtn = document.querySelector('.user-filter-btn[data-filter="unassigned"]');
        if (unassignedFilterBtn) {
            unassignedFilterBtn.classList.add('active');
            applyHighlighting(unassignedFilterBtn);
        }

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

        // Disable save button initially
        if (saveButton) {
            saveButton.disabled = true;

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
                        isDirty = false;
                        saveButton.disabled = true;
                        updateSlotCounts();
                        showToast('Schedule saved successfully');
                    } else {
                        showToast('Failed to save schedule', 'error');
                    }
                } catch (error) {
                    console.error('Error saving schedule:', error);
                    showToast('An error occurred while saving', 'error');
                }
            });
        }

        // Track changes to radio buttons
        radioButtons.forEach(radio => {
            radio.addEventListener('change', () => {
                isDirty = true;
                if (saveButton) saveButton.disabled = false;
                updateSlotCounts();

                // Get currently active filter
                const activeFilter = document.querySelector('.user-filter-btn.active');
                if (!activeFilter) return;

                applyHighlighting(activeFilter);
            });
        });

        // Handle filter clicks
        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Toggle active state
                const wasActive = btn.classList.contains('active');
                filterButtons.forEach(b => b.classList.remove('active'));
                if (!wasActive) {
                    btn.classList.add('active');
                    applyHighlighting(btn);
                } else {
                    clearHighlighting();
                }
            });
        });

        function applyHighlighting(filterBtn) {
            clearHighlighting();
            
            const userId = filterBtn.dataset.userId;
            const isUnassignedFilter = filterBtn.dataset.filter === 'unassigned';

            document.querySelectorAll('.user-option').forEach(option => {
                const radio = option.querySelector('input[type="radio"]');
                if (radio) {
                    if (isUnassignedFilter && radio.value === '' && radio.checked) {
                        option.classList.add('highlighted');
                    } else if (userId && radio.checked && radio.value === userId) {
                        option.classList.add('highlighted');
                    }
                }
            });
        }

        function clearHighlighting() {
            document.querySelectorAll('.user-option').forEach(option => {
                option.classList.remove('highlighted');
            });
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
                    showUnsavedChangesModal(e.currentTarget.href);
                }
            });
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

function showUnsavedChangesModal(targetHref) {
    const modal = document.getElementById('unsavedChangesModal');
    if (!modal) return;

    modal.style.display = 'flex';
    
    const stayButton = document.getElementById('stayButton');
    const leaveButton = document.getElementById('leaveButton');
    
    if (stayButton) {
        stayButton.onclick = () => {
            modal.style.display = 'none';
        };
    }
    
    if (leaveButton) {
        leaveButton.onclick = () => {
            window.location.href = targetHref;
        };
    }
} 