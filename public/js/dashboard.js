const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

document.addEventListener('DOMContentLoaded', () => {
    // Mobile day highlighting
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        const dayColumns = document.querySelectorAll('.day-column');
        const today = new Date().getDay();
        const adjustedToday = today === 0 ? 6 : today - 1;
        dayColumns[adjustedToday]?.classList.add('current-day');
    }

    // Handle resize events
    let timeout;
    let wasMobile = window.innerWidth <= 768;

    window.addEventListener('resize', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            const isMobileNow = window.innerWidth <= 768;
            // Only reload if we're crossing the mobile breakpoint
            if (wasMobile !== isMobileNow) {
                location.reload();
                wasMobile = isMobileNow;
            }
        }, 250);
    });

    // Calendar Export Functionality
    const exportButton = document.getElementById('exportCalendar');
    if (exportButton) {
        exportButton.addEventListener('click', () => {
            window.location.href = '/export-calendar';
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

function highlightCurrentTimeslot() {
    // Only highlight if we're viewing the current week
    const weekTitle = document.querySelector('.week-title').textContent;
    if (weekTitle !== 'This Week') return;

    const now = new Date();
    let currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Adjust currentDay to match our days array
    currentDay = currentDay === 0 ? 6 : currentDay - 1;

    const timeSlots = [
        { hour: 8, minute: 0 },   // 8:00am
        { hour: 12, minute: 30 }, // 12:30pm 
        { hour: 17, minute: 0 },  // 5:00pm
        { hour: 21, minute: 30 }  // 9:30pm
    ];

    let currentSlot = null;
    for (const slot of timeSlots) {
        if (currentHour < slot.hour || (currentHour === slot.hour && currentMinute < slot.minute)) {
            currentSlot = slot;
            break;
        }
    }

    if (!currentSlot) {
        currentSlot = timeSlots[0]; // Default to first slot of next day
    }

    // Remove any existing highlights
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('current-slot');
    });

    const slotElements = document.querySelectorAll('.time-slot');
    let highlightedSlot = null;
    slotElements.forEach(slot => {
        const slotTime = slot.querySelector('.time').textContent;
        let [time, period] = slotTime.split(/([ap]m)/i);
        let [slotHour, slotMinute] = time.split(':');
        
        // Convert to 24-hour format if needed
        slotHour = parseInt(slotHour);
        slotMinute = parseInt(slotMinute);
        if (period && period.toLowerCase() === 'pm' && slotHour !== 12) {
            slotHour += 12;
        }
        if (period && period.toLowerCase() === 'am' && slotHour === 12) {
            slotHour = 0;
        }
        
        if (slotHour === currentSlot.hour && slotMinute === currentSlot.minute) {
            const slotDay = slot.closest('.day-column');
            if (slotDay && slotDay.querySelector('.day-name').textContent.toLowerCase() === days[currentDay]) {
                slot.classList.add('current-slot');
                highlightedSlot = slot;
            }
        }
    });

    // Scroll to highlighted slot on mobile
    if (highlightedSlot && window.innerWidth <= 768) {
        highlightedSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Call on page load
highlightCurrentTimeslot();

// Call whenever page comes into view
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        highlightCurrentTimeslot();
    }
}); 