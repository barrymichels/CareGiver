document.addEventListener('DOMContentLoaded', () => {
    const profileButton = document.getElementById('profileButton');
    const profileMenu = document.getElementById('profileMenu');

    if (profileButton && profileMenu) {
        // Toggle profile menu for both click and touch
        function toggleMenu(e) {
            e.preventDefault();
            e.stopPropagation();
            profileMenu.classList.toggle('active');
        }

        // Add both click and touch handlers
        profileButton.addEventListener('click', toggleMenu);
        profileButton.addEventListener('touchend', toggleMenu);

        // Close menu when clicking/touching outside
        function closeMenu(e) {
            if (!profileMenu.contains(e.target) && !profileButton.contains(e.target)) {
                profileMenu.classList.remove('active');
            }
        }

        document.addEventListener('click', closeMenu);
        document.addEventListener('touchend', closeMenu);
    }
}); 