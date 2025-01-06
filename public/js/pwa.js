let deferredPrompt;

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