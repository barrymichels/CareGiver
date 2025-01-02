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

    let isDirty = false;
    const saveButton = document.getElementById('saveSchedule');
    const unsavedChangesModal = document.getElementById('unsavedChangesModal');

    // Disable save button initially
    saveButton.disabled = true;

    // Track changes to any checkbox
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            isDirty = true;
            saveButton.disabled = false;
        });
    });

    // Handle save button click
    saveButton.addEventListener('click', async () => {
        try {
            // ... existing save logic ...

            // On successful save
            isDirty = false;
            saveButton.disabled = true;
            
            // Show success message
            const toast = document.createElement('div');
            toast.className = 'toast success';
            toast.textContent = 'Schedule saved successfully';
            document.body.appendChild(toast);
            
            // Remove toast after 3 seconds
            setTimeout(() => {
                toast.remove();
            }, 3000);
        } catch (error) {
            console.error('Error saving schedule:', error);
        }
    });

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
                unsavedChangesModal.style.display = 'flex';
                
                document.getElementById('stayButton').onclick = () => {
                    unsavedChangesModal.style.display = 'none';
                };
                
                document.getElementById('leaveButton').onclick = () => {
                    isDirty = false;
                    window.location.href = targetHref;
                };
            }
        });
    });

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
}); 