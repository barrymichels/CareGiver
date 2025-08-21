document.addEventListener('DOMContentLoaded', () => {
    const profileForm = document.getElementById('profile-form');
    const passwordForm = document.getElementById('password-form');
    const notificationForm = document.getElementById('notification-form');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const passwordModal = document.getElementById('passwordModal');
    const closeModalBtn = document.querySelector('.close-modal');
    
    // Notification elements
    const morningSummaryCheckbox = document.getElementById('morningSummaryEnabled');
    const morningSummaryTimeGroup = document.getElementById('morningSummaryTimeGroup');
    const enablePushBtn = document.getElementById('enablePushBtn');
    const pushBtnText = document.getElementById('pushBtnText');
    const pushBtnStatus = document.getElementById('pushBtnStatus');
    
    let currentPushSubscription = null;
    let vapidPublicKey = null;

    // Profile form submission
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(profileForm);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch('/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                showToast('Profile updated successfully', 'success');
            } else {
                const responseData = await response.json();
                showToast(responseData.error || 'Failed to update profile', 'error');
            }
        } catch (error) {
            showToast('An error occurred', 'error');
        }
    });

    // Password form submission
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(passwordForm);
        const data = Object.fromEntries(formData);

        if (data.newPassword !== data.confirmPassword) {
            showToast('Passwords do not match', 'error');
            return;
        }

        try {
            const response = await fetch('/profile/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    currentPassword: data.currentPassword,
                    newPassword: data.newPassword,
                    confirmPassword: data.confirmPassword
                }),
            });

            if (response.ok) {
                showToast('Password updated successfully', 'success');
                passwordForm.reset();
                passwordModal.classList.remove('active');
            } else {
                const responseData = await response.json();
                showToast(responseData.error || 'Failed to update password', 'error');
            }
        } catch (error) {
            showToast('An error occurred', 'error');
        }
    });

    // Modal handling
    changePasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        passwordModal.classList.add('active');
    });

    closeModalBtn.addEventListener('click', () => {
        passwordModal.classList.remove('active');
        passwordForm.reset();
    });

    passwordModal.addEventListener('click', (e) => {
        if (e.target === passwordModal) {
            passwordModal.classList.remove('active');
            passwordForm.reset();
        }
    });

    // Notification form submission
    notificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(notificationForm);
        const data = Object.fromEntries(formData);
        
        // Convert checkbox value to boolean
        data.morningSummaryEnabled = data.morningSummaryEnabled === 'on';

        try {
            const response = await fetch('/api/notifications/preferences', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    notificationAdvanceMinutes: parseInt(data.notificationAdvanceMinutes),
                    morningSummaryEnabled: data.morningSummaryEnabled,
                    morningSummaryTime: data.morningSummaryTime
                }),
            });

            if (response.ok) {
                showToast('Notification settings updated successfully', 'success');
            } else {
                const responseData = await response.json();
                showToast(responseData.error || 'Failed to update notification settings', 'error');
            }
        } catch (error) {
            showToast('An error occurred', 'error');
        }
    });

    // Morning summary checkbox toggle
    if (morningSummaryCheckbox) {
        morningSummaryCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                morningSummaryTimeGroup.style.display = 'block';
            } else {
                morningSummaryTimeGroup.style.display = 'none';
            }
        });
    }

    // Push notification button handling
    if (enablePushBtn) {
        enablePushBtn.addEventListener('click', async () => {
            const isCurrentlyEnabled = enablePushBtn.classList.contains('enabled');
            
            if (isCurrentlyEnabled) {
                await unsubscribeFromPush();
            } else {
                await subscribeToNotifications();
            }
        });
    }

    // Initialize notification functionality
    async function initializeNotifications() {
        try {
            // Check if service worker is supported
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                console.warn('Push notifications not supported');
                return;
            }

            // Get VAPID public key
            const keyResponse = await fetch('/api/notifications/vapid-public-key');
            if (keyResponse.ok) {
                const keyData = await keyResponse.json();
                vapidPublicKey = keyData.publicKey;
            }

            // Check current subscription status
            const registration = await navigator.serviceWorker.ready;
            currentPushSubscription = await registration.pushManager.getSubscription();
            
            updatePushButtonState();
        } catch (error) {
            console.error('Error initializing notifications:', error);
        }
    }

    async function subscribeToNotifications() {
        try {
            // Request permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                showToast('Push notifications permission denied', 'error');
                return;
            }

            // Get service worker registration
            const registration = await navigator.serviceWorker.ready;

            // Subscribe to push notifications
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            });

            // Send subscription to server
            const response = await fetch('/api/notifications/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ subscription }),
            });

            if (response.ok) {
                currentPushSubscription = subscription;
                updatePushButtonState();
                showToast('Push notifications enabled successfully', 'success');
            } else {
                const errorData = await response.json();
                showToast(errorData.error || 'Failed to enable push notifications', 'error');
            }
        } catch (error) {
            console.error('Error subscribing to push notifications:', error);
            showToast('Error enabling push notifications', 'error');
        }
    }

    async function unsubscribeFromPush() {
        try {
            if (currentPushSubscription) {
                await currentPushSubscription.unsubscribe();
            }

            // Notify server
            const response = await fetch('/api/notifications/subscribe', {
                method: 'DELETE'
            });

            if (response.ok) {
                currentPushSubscription = null;
                updatePushButtonState();
                showToast('Push notifications disabled', 'success');
            } else {
                const errorData = await response.json();
                showToast(errorData.error || 'Failed to disable push notifications', 'error');
            }
        } catch (error) {
            console.error('Error unsubscribing from push notifications:', error);
            showToast('Error disabling push notifications', 'error');
        }
    }

    function updatePushButtonState() {
        if (!enablePushBtn) return;

        const isEnabled = currentPushSubscription !== null;
        
        if (isEnabled) {
            enablePushBtn.classList.add('enabled');
            pushBtnText.textContent = 'Disable Push Notifications';
            pushBtnStatus.textContent = 'Enabled';
        } else {
            enablePushBtn.classList.remove('enabled');
            pushBtnText.textContent = 'Enable Push Notifications';
            pushBtnStatus.textContent = 'Disabled';
        }
    }

    // Utility function to convert VAPID key
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // Toast notification function
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Remove toast after animation
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Initialize notifications when page loads
    initializeNotifications();
}); 