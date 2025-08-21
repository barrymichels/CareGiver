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

    // Call highlighting after DOM is fully loaded
    setTimeout(highlightCurrentTimeslot, 100);
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
    // Get the current week title
    const weekTitle = document.querySelector('.week-title')?.textContent;
    if (!weekTitle) return;

    // Remove existing highlights first
    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('current-slot');
    });

    // Get the displayed dates from the DOM to account for both local and UTC time differences
    const dayColumns = document.querySelectorAll('.day-column');
    if (!dayColumns.length) return;

    // For "Next Week", always highlight the first slot of the first day (Monday)
    if (weekTitle === 'Next Week') {
        console.log("Next week view detected, highlighting first Monday slot");
        const mondayColumn = dayColumns[0]; // Monday is the first column
        if (mondayColumn) {
            const slots = mondayColumn.querySelectorAll('.time-slot');
            const firstSlot = slots[0];
            if (firstSlot) {
                firstSlot.classList.add('current-slot');
                console.log("Highlighted first Monday slot");

                // Scroll to highlighted slot on mobile
                if (window.innerWidth <= 768) {
                    firstSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
        return;
    }

    // Only continue highlighting for "This Week"
    if (weekTitle !== 'This Week') return;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Extract dates from the displayed calendar
    const displayedDates = Array.from(dayColumns).map(column => {
        const dayName = column.querySelector('.day-name').textContent.toLowerCase();
        const dateText = column.querySelector('.day-date').textContent.trim();
        return {
            element: column,
            dayName,
            dateText,
            slots: Array.from(column.querySelectorAll('.time-slot'))
        };
    });

    // Parse current date to match format (Apr 6)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonthShort = monthNames[now.getMonth()];
    const currentDay = now.getDate();
    const currentFormatted = `${currentMonthShort} ${currentDay}`;

    // Find the column that matches today's date
    const todayColumn = displayedDates.find(col => col.dateText.includes(currentFormatted));
    if (!todayColumn) return; // Today not in view

    const todayIndex = displayedDates.indexOf(todayColumn);

    // Extract dynamic time slots from today's column
    const timeSlots = [];
    todayColumn.slots.forEach(slotElement => {
        const timeText = slotElement.querySelector('.time')?.textContent;
        if (timeText) {
            const parsedTime = parseTime(timeText);
            if (parsedTime) {
                timeSlots.push({
                    hour: parsedTime.hour,
                    minute: parsedTime.minute,
                    element: slotElement,
                    timeText: timeText
                });
            }
        }
    });

    // Sort slots by time
    timeSlots.sort((a, b) => {
        if (a.hour !== b.hour) return a.hour - b.hour;
        return a.minute - b.minute;
    });

    // Find the next upcoming slot
    let foundSlot = false;

    // First check today's remaining slots
    for (let i = 0; i < timeSlots.length; i++) {
        const slot = timeSlots[i];
        if (currentHour < slot.hour || (currentHour === slot.hour && currentMinute < slot.minute)) {
            // This slot is still upcoming today
            slot.element.classList.add('current-slot');
            if (window.innerWidth <= 768) {
                slot.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            foundSlot = true;
            break;
        }
    }

    // If no upcoming slots today, check the next day
    if (!foundSlot && todayIndex < displayedDates.length - 1) {
        const tomorrowColumn = displayedDates[todayIndex + 1];
        const firstSlot = tomorrowColumn.slots[0];

        if (firstSlot) {
            firstSlot.classList.add('current-slot');
            if (window.innerWidth <= 768) {
                firstSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

// Call whenever page comes into view
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        highlightCurrentTimeslot();
    }
});

function get12HourFormat(hour, minute) {
    const adjustedHour = hour > 12 ? hour - 12 : hour;
    const period = hour >= 12 ? 'pm' : 'am';
    return `${adjustedHour}:${minute.toString().padStart(2, '0')}${period}`;
}

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return null;
    
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toLowerCase();
    
    if (period === 'pm' && hours !== 12) {
        hours += 12;
    } else if (period === 'am' && hours === 12) {
        hours = 0;
    }
    
    return { hour: hours, minute: minutes };
}