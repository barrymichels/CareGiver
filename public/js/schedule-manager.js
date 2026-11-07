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

        // Applying a template shares the schedule's unsaved-assignment guard.
        const templateDialog = document.getElementById('weekTemplateDialog');
        if (templateDialog) {
            const form = document.getElementById('weekTemplateForm');
            const select = document.getElementById('weekTemplateSelect');
            const apply = document.getElementById('applyWeekTemplate');
            const cancel = document.getElementById('cancelWeekTemplate');
            const conflicts = document.getElementById('weekTemplateConflicts');
            const error = document.getElementById('weekTemplateError');
            let confirmedTemplate = null, applying = false;
            function resetPreview() {
                confirmedTemplate = null;
                conflicts.hidden = true;
                conflicts.replaceChildren();
                error.textContent = '';
                apply.textContent = 'Apply to this week';
            }
            document.getElementById('changeWeekTemplate').onclick = () => {
                if (isDirty && !confirm('Applying a template will discard your unsaved assignments. Continue?')) return;
                resetPreview();
                templateDialog.showModal();
            };
            select.onchange = resetPreview;
            cancel.onclick = () => templateDialog.close();
            templateDialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
            form.onsubmit = async event => {
                event.preventDefault();
                if (applying) return;
                applying = true;
                select.disabled = apply.disabled = cancel.disabled = true;
                error.textContent = '';
                try {
                    const response = await fetch('/admin/timeslots/apply-template', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ weekStart: form.dataset.weekStart,
                            templateId: select.value === 'default' ? null : Number(select.value),
                            ignoreConflicts: confirmedTemplate === select.value })
                    });
                    if (response.redirected) throw new Error('Your session has expired. Reload and sign in again.');
                    const result = await response.json();
                    if (response.status === 409 && result.conflicts) {
                        confirmedTemplate = select.value;
                        conflicts.replaceChildren();
                        const warning = document.createElement('p');
                        warning.textContent = 'These saved entries are at times removed by this template. Applying will clear only the entries listed below.';
                        conflicts.appendChild(warning);
                        for (const [kind, entries] of Object.entries(result.conflicts)) {
                            if (!Array.isArray(entries)) continue;
                            const list = document.createElement('ul');
                            entries.forEach(entry => {
                                const item = document.createElement('li');
                                item.textContent = `${kind === 'assignments' ? 'Assignment' : 'Availability'}: ${entry.first_name} ${entry.last_name} · ${entry.day_date} · ${entry.time_slot}`;
                                list.appendChild(item);
                            });
                            conflicts.appendChild(list);
                        }
                        conflicts.hidden = false;
                        apply.textContent = 'Clear listed entries and apply';
                        return;
                    }
                    if (!response.ok) throw new Error(result.error || 'Could not apply template.');
                    isDirty = false;
                    window.location.reload();
                } catch (failure) {
                    error.textContent = failure.message || 'Could not apply template. Please try again.';
                } finally {
                    applying = false;
                    select.disabled = apply.disabled = cancel.disabled = false;
                }
            };
        }

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
                // Get all radio groups
                const slotGroups = new Set();
                radioButtons.forEach(radio => {
                    slotGroups.add(radio.name);
                });

                // For each slot group, find the checked radio and include it in assignments
                slotGroups.forEach(groupName => {
                    const checkedRadio = document.querySelector(`input[name="${groupName}"]:checked`);
                    if (checkedRadio && checkedRadio.dataset.date) {
                        assignments.push({
                            userId: checkedRadio.value ? parseInt(checkedRadio.value) : null,
                            date: checkedRadio.dataset.date,
                            time: checkedRadio.dataset.time,
                            hasConflict: checkedRadio.closest('.user-option')?.classList.contains('conflict') || false,
                            unassign: !checkedRadio.value // Add flag for unassignment
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
                        
                        // Show warning if there are conflicts
                        const conflictCount = assignments.filter(a => a.hasConflict).length;
                        if (conflictCount > 0) {
                            await showToast(`Schedule saved with ${conflictCount} availability conflict${conflictCount > 1 ? 's' : ''}`, 'warning');
                        } else {
                            await showToast('Schedule saved successfully');
                        }
                        // Reload the page after toast
                        window.location.reload();
                    } else {
                        const result = await response.json();
                        await showToast(result.error || 'Failed to save schedule', 'error');
                    }
                } catch (error) {
                    console.error('Error saving schedule:', error);
                    await showToast('An error occurred while saving', 'error');
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
    return new Promise(resolve => {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Add warning color styles
        if (type === 'warning') {
            toast.style.backgroundColor = 'rgba(255, 193, 7, 0.9)';
            toast.style.color = '#000';
        }
        
        setTimeout(() => {
            toast.remove();
            resolve();
        }, 3000);
    });
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