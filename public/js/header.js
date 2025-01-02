document.addEventListener('DOMContentLoaded', () => {
    const profileButton = document.querySelector('.profile-button');
    const dropdownMenu = document.querySelector('.dropdown-menu');

    // Toggle dropdown when clicking profile button
    profileButton.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('active');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!profileButton.contains(e.target)) {
            dropdownMenu.classList.remove('active');
        }
    });

    // Close dropdown when pressing escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdownMenu.classList.remove('active');
        }
    });

    // Handle dropdown menu keyboard navigation
    dropdownMenu.addEventListener('keydown', (e) => {
        const menuItems = dropdownMenu.querySelectorAll('.menu-item');
        const currentIndex = Array.from(menuItems).indexOf(document.activeElement);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < menuItems.length - 1) {
                    menuItems[currentIndex + 1].focus();
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    menuItems[currentIndex - 1].focus();
                }
                break;
            case 'Tab':
                if (!e.shiftKey && currentIndex === menuItems.length - 1) {
                    dropdownMenu.classList.remove('active');
                }
                break;
        }
    });
}); 