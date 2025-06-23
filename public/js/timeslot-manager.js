/**
 * Timeslot Manager - Frontend JavaScript for managing timeslot configurations
 */

// Global state
let currentTimeslots = {};
let isDirty = false;
let currentEditSlot = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize current timeslots from server data
    currentTimeslots = window.weekData?.timeslots || {};
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Enable/disable controls based on modification permission
    if (!window.canModify) {
        disableAllControls();
    }
});

function initializeEventListeners() {
    // Template selector
    const templateSelect = document.getElementById('templateSelect');
    const applyTemplateBtn = document.getElementById('applyTemplateBtn');
    
    if (templateSelect) {
        templateSelect.addEventListener('change', () => {
            applyTemplateBtn.disabled = !templateSelect.value;
        });
    }
    
    if (applyTemplateBtn) {
        applyTemplateBtn.addEventListener('click', applySelectedTemplate);
    }
    
    // Action buttons
    const copyFromLastWeekBtn = document.getElementById('copyFromLastWeekBtn');
    if (copyFromLastWeekBtn) {
        copyFromLastWeekBtn.addEventListener('click', copyFromLastWeek);
    }
    
    const saveAsTemplateBtn = document.getElementById('saveAsTemplateBtn');
    if (saveAsTemplateBtn) {
        saveAsTemplateBtn.addEventListener('click', () => openModal('saveTemplateModal'));
    }
    
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', saveConfiguration);
    }
    
    const resetConfigBtn = document.getElementById('resetConfigBtn');
    if (resetConfigBtn) {
        resetConfigBtn.addEventListener('click', resetToDefault);
    }
    
    // Form submissions
    const editSlotForm = document.getElementById('editSlotForm');
    if (editSlotForm) {
        editSlotForm.addEventListener('submit', handleEditSlotSubmit);
    }
    
    const saveTemplateForm = document.getElementById('saveTemplateForm');
    if (saveTemplateForm) {
        saveTemplateForm.addEventListener('submit', handleSaveTemplateSubmit);
    }
    
    // Conflict resolution
    const proceedWithChanges = document.getElementById('proceedWithChanges');
    if (proceedWithChanges) {
        proceedWithChanges.addEventListener('click', () => {
            document.getElementById('conflictWarning').style.display = 'none';
            saveConfiguration(true); // Force save ignoring conflicts
        });
    }
    
    const cancelChanges = document.getElementById('cancelChanges');
    if (cancelChanges) {
        cancelChanges.addEventListener('click', () => {
            document.getElementById('conflictWarning').style.display = 'none';
        });
    }
    
    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
}

function disableAllControls() {
    const controls = document.querySelectorAll('button, input, select');
    controls.forEach(control => {
        if (!control.classList.contains('nav-button') && !control.classList.contains('close-modal')) {
            control.disabled = true;
        }
    });
}

function addSlot(dayIndex) {
    currentEditSlot = {
        dayIndex,
        slotIndex: -1, // -1 indicates new slot
        isNew: true
    };
    
    // Clear form
    document.getElementById('slotTime').value = '';
    document.getElementById('slotLabel').value = '';
    document.querySelector('#editSlotModal .modal-title').textContent = 'Add Timeslot';
    
    openModal('editSlotModal');
}

function editSlot(dayIndex, slotIndex) {
    const slot = currentTimeslots[dayIndex][slotIndex];
    if (!slot) return;
    
    currentEditSlot = {
        dayIndex,
        slotIndex,
        isNew: false
    };
    
    // Populate form - convert 12-hour format to 24-hour for time input
    document.getElementById('slotTime').value = convertTo24Hour(slot.time);
    document.getElementById('slotLabel').value = slot.label;
    document.querySelector('#editSlotModal .modal-title').textContent = 'Edit Timeslot';
    
    openModal('editSlotModal');
}

function deleteSlot(dayIndex, slotIndex) {
    if (!confirm('Are you sure you want to delete this timeslot?')) {
        return;
    }
    
    // Remove from current data
    currentTimeslots[dayIndex].splice(slotIndex, 1);
    
    // Update slot orders
    currentTimeslots[dayIndex].forEach((slot, index) => {
        slot.slot_order = index;
    });
    
    // Re-render the day
    renderDay(dayIndex);
    markDirty();
}

function copyDayToAll(sourceDayIndex) {
    const sourceSlots = currentTimeslots[sourceDayIndex] || [];
    
    if (sourceSlots.length === 0) {
        showToast('No timeslots to copy from this day', 'error');
        return;
    }
    
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const sourceDayName = dayNames[sourceDayIndex];
    
    if (!confirm(`Copy ${sourceSlots.length} timeslot(s) from ${sourceDayName} to all other days? This will replace existing timeslots on all days.`)) {
        return;
    }
    
    // Copy the source day's slots to all other days
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        if (dayIndex === sourceDayIndex) continue; // Skip the source day
        
        // Deep copy the slots and update day_of_week
        currentTimeslots[dayIndex] = sourceSlots.map(slot => ({
            ...slot,
            day_of_week: dayIndex,
            id: null // Clear ID since these are new slots
        }));
    }
    
    // Re-render all days
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        renderDay(dayIndex);
    }
    
    markDirty();
    showToast(`Copied timeslots from ${sourceDayName} to all days`);
}

function handleEditSlotSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const time24h = formData.get('time').trim();
    const label = formData.get('label').trim();
    
    if (!time24h || !label) {
        showToast('Time and label are required', 'error');
        return;
    }
    
    // Convert 24-hour format to 12-hour format for storage
    const time12h = convertTo12Hour(time24h);
    
    // Check for duplicate times on same day
    const daySlots = currentTimeslots[currentEditSlot.dayIndex] || [];
    const isDuplicate = daySlots.some((slot, index) => 
        slot.time === time12h && index !== currentEditSlot.slotIndex
    );
    
    if (isDuplicate) {
        showToast('A timeslot with this time already exists for this day', 'error');
        return;
    }
    
    const slotData = {
        time: time12h,
        label,
        day_of_week: currentEditSlot.dayIndex
    };
    
    if (currentEditSlot.isNew) {
        // Add new slot
        if (!currentTimeslots[currentEditSlot.dayIndex]) {
            currentTimeslots[currentEditSlot.dayIndex] = [];
        }
        
        slotData.slot_order = currentTimeslots[currentEditSlot.dayIndex].length;
        currentTimeslots[currentEditSlot.dayIndex].push(slotData);
    } else {
        // Update existing slot
        const existingSlot = currentTimeslots[currentEditSlot.dayIndex][currentEditSlot.slotIndex];
        Object.assign(existingSlot, slotData);
        existingSlot.slot_order = currentEditSlot.slotIndex;
    }
    
    // Sort slots by time
    sortDaySlots(currentEditSlot.dayIndex);
    
    // Re-render the day
    renderDay(currentEditSlot.dayIndex);
    markDirty();
    
    closeModal('editSlotModal');
    showToast(currentEditSlot.isNew ? 'Timeslot added successfully' : 'Timeslot updated successfully');
}

function sortDaySlots(dayIndex) {
    if (!currentTimeslots[dayIndex]) return;
    
    currentTimeslots[dayIndex].sort((a, b) => {
        return parseTime(a.time) - parseTime(b.time);
    });
    
    // Update slot orders
    currentTimeslots[dayIndex].forEach((slot, index) => {
        slot.slot_order = index;
    });
}

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return 0;
    
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toLowerCase();
    
    if (period === 'pm' && hours !== 12) {
        hours += 12;
    } else if (period === 'am' && hours === 12) {
        hours = 0;
    }
    
    return hours * 60 + minutes;
}

/**
 * Convert 12-hour format (8:00am) to 24-hour format (08:00) for time input
 */
function convertTo24Hour(time12h) {
    const match = time12h.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return '';
    
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toLowerCase();
    
    if (period === 'pm' && hours !== 12) {
        hours += 12;
    } else if (period === 'am' && hours === 12) {
        hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

/**
 * Convert 24-hour format (08:00) to 12-hour format (8:00am) for storage
 */
function convertTo12Hour(time24h) {
    const [hours24, minutes] = time24h.split(':');
    let hours = parseInt(hours24);
    const period = hours >= 12 ? 'pm' : 'am';
    
    if (hours === 0) {
        hours = 12;
    } else if (hours > 12) {
        hours -= 12;
    }
    
    return `${hours}:${minutes}${period}`;
}

function renderDay(dayIndex) {
    const dayContainer = document.getElementById(`day-${dayIndex}-slots`);
    if (!dayContainer) return;
    
    const daySlots = currentTimeslots[dayIndex] || [];
    
    // Clear existing slots but keep the add button
    const existingSlots = dayContainer.querySelectorAll('.timeslot-item');
    existingSlots.forEach(slot => slot.remove());
    
    // Add slots before the add button
    const addButton = dayContainer.querySelector('.add-slot-btn');
    
    daySlots.forEach((slot, slotIndex) => {
        const slotElement = document.createElement('div');
        slotElement.className = 'timeslot-item';
        slotElement.setAttribute('data-slot-order', slotIndex);
        
        slotElement.innerHTML = `
            <div class="slot-info">
                <div class="slot-time">${slot.time}</div>
                <div class="slot-label">${slot.label}</div>
            </div>
            ${window.canModify ? `
                <div class="slot-actions">
                    <button type="button" class="edit-slot" onclick="editSlot(${dayIndex}, ${slotIndex})" title="Edit timeslot">✏️</button>
                    <button type="button" class="delete-slot" onclick="deleteSlot(${dayIndex}, ${slotIndex})" title="Delete timeslot">✕</button>
                </div>
            ` : ''}
        `;
        
        dayContainer.insertBefore(slotElement, addButton);
    });
    
    // Update the copy button if it doesn't exist
    if (window.canModify && !dayContainer.querySelector('.copy-day-btn')) {
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'copy-day-btn';
        copyButton.onclick = () => copyDayToAll(dayIndex);
        copyButton.innerHTML = '📋 Copy to All Days';
        dayContainer.appendChild(copyButton);
    }
}

async function applySelectedTemplate() {
    const templateSelect = document.getElementById('templateSelect');
    const templateId = templateSelect.value;
    
    if (!templateId) return;
    
    try {
        const response = await fetch(`/admin/timeslot-templates/${templateId}/apply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                weekStart: window.weekStart
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Update current timeslots
            currentTimeslots = result.data.timeslots;
            
            // Re-render all days
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                renderDay(dayIndex);
            }
            
            markClean();
            showToast('Template applied successfully');
        } else {
            showToast(result.error || 'Failed to apply template', 'error');
        }
    } catch (error) {
        console.error('Error applying template:', error);
        showToast('Failed to apply template', 'error');
    }
}

async function copyFromLastWeek() {
    const currentWeekStart = new Date(window.weekStart);
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(currentWeekStart.getDate() - 7);
    
    try {
        const response = await fetch('/admin/timeslots/copy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targetWeekStart: window.weekStart,
                sourceWeekStart: lastWeekStart.toISOString().split('T')[0]
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Update current timeslots
            currentTimeslots = result.data.timeslots;
            
            // Re-render all days
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                renderDay(dayIndex);
            }
            
            markClean();
            showToast('Timeslots copied from last week successfully');
        } else {
            showToast(result.error || 'Failed to copy from last week', 'error');
        }
    } catch (error) {
        console.error('Error copying from last week:', error);
        showToast('Failed to copy from last week', 'error');
    }
}

async function saveConfiguration(ignoreConflicts = false) {
    // Convert current timeslots to API format
    const slots = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const daySlots = currentTimeslots[dayIndex] || [];
        daySlots.forEach(slot => {
            slots.push({
                day_of_week: dayIndex,
                time: slot.time,
                label: slot.label,
                slot_order: slot.slot_order
            });
        });
    }
    
    if (slots.length === 0) {
        showToast('At least one timeslot is required', 'error');
        return;
    }
    
    const requestBody = {
        weekStart: window.weekStart,
        slots,
        ignoreConflicts
    };
    
    try {
        const method = window.weekData.config ? 'PUT' : 'POST';
        const url = window.weekData.config 
            ? `/admin/timeslots/${window.weekData.config.id}`
            : '/admin/timeslots';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            markClean();
            showToast('Configuration saved successfully');
            
            // Update window data
            window.weekData = result.data;
        } else if (response.status === 409 && result.conflicts) {
            // Show conflict warning
            showConflictWarning(result.conflicts);
        } else {
            showToast(result.error || 'Failed to save configuration', 'error');
        }
    } catch (error) {
        console.error('Error saving configuration:', error);
        showToast('Failed to save configuration', 'error');
    }
}

function showConflictWarning(conflicts) {
    const warningDiv = document.getElementById('conflictWarning');
    const conflictList = document.getElementById('conflictList');
    
    let conflictHtml = '';
    
    if (conflicts.availability.length > 0) {
        conflictHtml += '<h4>Affected Availability:</h4>';
        conflicts.availability.forEach(item => {
            conflictHtml += `<div class="conflict-item">${item.first_name} ${item.last_name} - ${item.day_date} ${item.time_slot}</div>`;
        });
    }
    
    if (conflicts.assignments.length > 0) {
        conflictHtml += '<h4>Affected Assignments:</h4>';
        conflicts.assignments.forEach(item => {
            conflictHtml += `<div class="conflict-item">${item.first_name} ${item.last_name} - ${item.day_date} ${item.time_slot}</div>`;
        });
    }
    
    conflictList.innerHTML = conflictHtml;
    warningDiv.style.display = 'block';
}

async function resetToDefault() {
    if (!confirm('Reset to default template? This will lose any unsaved changes.')) {
        return;
    }
    
    // Find default template
    const defaultTemplate = window.templates.find(t => t.is_default);
    if (!defaultTemplate) {
        showToast('No default template found', 'error');
        return;
    }
    
    // Apply default template
    try {
        const response = await fetch(`/admin/timeslot-templates/${defaultTemplate.id}`);
        const templateData = await response.json();
        
        if (response.ok) {
            currentTimeslots = templateData.slots;
            
            // Re-render all days
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                renderDay(dayIndex);
            }
            
            markDirty();
            showToast('Reset to default template');
        } else {
            showToast('Failed to load default template', 'error');
        }
    } catch (error) {
        console.error('Error resetting to default:', error);
        showToast('Failed to reset to default template', 'error');
    }
}

async function handleSaveTemplateSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const name = formData.get('name').trim();
    const description = formData.get('description').trim();
    const isDefault = formData.get('isDefault') === 'on';
    
    // Convert current timeslots to template format
    const slots = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const daySlots = currentTimeslots[dayIndex] || [];
        daySlots.forEach(slot => {
            slots.push({
                day_of_week: dayIndex,
                time: slot.time,
                label: slot.label,
                slot_order: slot.slot_order
            });
        });
    }
    
    if (slots.length === 0) {
        showToast('No timeslots to save as template', 'error');
        return;
    }
    
    try {
        const response = await fetch('/admin/timeslot-templates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                description,
                slots,
                isDefault
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeModal('saveTemplateModal');
            showToast('Template saved successfully');
            
            // Reset form
            e.target.reset();
            
            // Refresh template list
            location.reload();
        } else {
            showToast(result.error || 'Failed to save template', 'error');
        }
    } catch (error) {
        console.error('Error saving template:', error);
        showToast('Failed to save template', 'error');
    }
}

function markDirty() {
    isDirty = true;
    const saveBtn = document.getElementById('saveConfigBtn');
    if (saveBtn) {
        saveBtn.style.background = '#f39c12';
        saveBtn.textContent = 'Save Configuration *';
    }
}

function markClean() {
    isDirty = false;
    const saveBtn = document.getElementById('saveConfigBtn');
    if (saveBtn) {
        saveBtn.style.background = '';
        saveBtn.textContent = 'Save Configuration';
    }
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Add toast styles
const style = document.createElement('style');
style.textContent = `
    .toast {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        padding: 1rem 2rem;
        border-radius: 4px;
        background-color: var(--success-color);
        color: white;
        animation: slideIn 0.3s ease-out, fadeOut 0.3s ease-out 2.7s;
        z-index: 1000;
    }

    .toast.error {
        background-color: var(--danger-color);
    }

    @keyframes slideIn {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }

    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
`;
document.head.appendChild(style);