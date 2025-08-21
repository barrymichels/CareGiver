let deferredPrompt;
let hasShownNotificationFeature = false;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show install button or notification
    showInstallPromotion();
});

function showInstallPromotion() {
    // Add your install promotion UI here
    const installButton = document.createElement('button');
    installButton.textContent = 'Install App';
    installButton.className = 'install-button';
    installButton.addEventListener('click', installPWA);
    document.body.appendChild(installButton);
}

async function installPWA() {
    if (!deferredPrompt) return;
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    // We no longer need the prompt
    deferredPrompt = null;
}

// Check for new features and show announcements for existing users
window.addEventListener('load', () => {
    // Check if this is an existing installation that got updated
    if ('serviceWorker' in navigator) {
        checkForNewFeatures();
    }
});

async function checkForNewFeatures() {
    try {
        // Check if we've already shown the notification feature announcement
        const hasSeenNotificationFeature = localStorage.getItem('seen-notification-feature');
        const appVersion = localStorage.getItem('app-version');
        
        // If this is an upgrade from v1 to v2, show the notification feature
        if (!hasSeenNotificationFeature && appVersion === 'v1') {
            showNotificationFeatureAnnouncement();
        }
        
        // Update app version
        localStorage.setItem('app-version', 'v2');
        
    } catch (error) {
        console.warn('Error checking for new features:', error);
    }
}

function showNotificationFeatureAnnouncement() {
    if (hasShownNotificationFeature) return;
    
    // Only show if we're not on the profile page (to avoid duplicating the UI)
    if (window.location.pathname === '/profile') return;
    
    hasShownNotificationFeature = true;
    localStorage.setItem('seen-notification-feature', 'true');
    
    // Create a non-intrusive banner
    const banner = document.createElement('div');
    banner.className = 'feature-announcement';
    banner.innerHTML = `
        <div class="announcement-content">
            <div class="announcement-text">
                <h4>📱 New Feature: Push Notifications!</h4>
                <p>Stay informed about your shifts with timely reminders and daily summaries.</p>
            </div>
            <div class="announcement-actions">
                <a href="/profile" class="btn btn-primary">Set Up Notifications</a>
                <button class="btn btn-secondary" onclick="dismissFeatureAnnouncement()">Maybe Later</button>
            </div>
        </div>
        <button class="close-btn" onclick="dismissFeatureAnnouncement()">×</button>
    `;
    
    // Add styles for the announcement
    if (!document.getElementById('announcement-styles')) {
        const styles = document.createElement('style');
        styles.id = 'announcement-styles';
        styles.textContent = `
            .feature-announcement {
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--card-bg);
                border: 1px solid var(--primary-color);
                border-radius: 8px;
                padding: 1rem;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                max-width: 500px;
                width: 90%;
                z-index: 1000;
                animation: slideInDown 0.3s ease-out;
            }
            
            .announcement-content {
                display: flex;
                align-items: center;
                gap: 1rem;
                margin-bottom: 0.5rem;
            }
            
            .announcement-text h4 {
                margin: 0 0 0.25rem 0;
                color: var(--text-color);
                font-size: 1rem;
            }
            
            .announcement-text p {
                margin: 0;
                font-size: 0.875rem;
                color: var(--text-muted);
            }
            
            .announcement-actions {
                display: flex;
                gap: 0.5rem;
                flex-shrink: 0;
            }
            
            .announcement-actions .btn {
                padding: 0.5rem 1rem;
                border-radius: 4px;
                text-decoration: none;
                font-size: 0.875rem;
                cursor: pointer;
                border: none;
                transition: all 0.2s ease;
            }
            
            .btn-primary {
                background: var(--primary-color);
                color: white;
            }
            
            .btn-primary:hover {
                background: var(--primary-hover);
            }
            
            .btn-secondary {
                background: var(--input-bg);
                color: var(--text-color);
                border: 1px solid var(--input-border);
            }
            
            .btn-secondary:hover {
                background: var(--card-bg);
            }
            
            .close-btn {
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                background: none;
                border: none;
                font-size: 1.25rem;
                cursor: pointer;
                color: var(--text-muted);
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .close-btn:hover {
                color: var(--text-color);
            }
            
            @keyframes slideInDown {
                from {
                    transform: translate(-50%, -20px);
                    opacity: 0;
                }
                to {
                    transform: translate(-50%, 0);
                    opacity: 1;
                }
            }
            
            @media (max-width: 768px) {
                .announcement-content {
                    flex-direction: column;
                    align-items: stretch;
                    text-align: center;
                }
                
                .announcement-actions {
                    justify-content: center;
                }
            }
        `;
        document.head.appendChild(styles);
    }
    
    document.body.appendChild(banner);
    
    // Auto-dismiss after 10 seconds if no interaction
    setTimeout(() => {
        dismissFeatureAnnouncement();
    }, 10000);
}

function dismissFeatureAnnouncement() {
    const banner = document.querySelector('.feature-announcement');
    if (banner) {
        banner.style.animation = 'slideInDown 0.3s ease-out reverse';
        setTimeout(() => banner.remove(), 300);
    }
}

// Make the dismiss function globally available
window.dismissFeatureAnnouncement = dismissFeatureAnnouncement;