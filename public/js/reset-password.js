document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reset-password-form');

    // Duplicated from auth.js on purpose for now: these are plain script tags with no
    // bundler, so a shared module would mean a load-order dependency in front of the
    // login form. The wording must be changed in both files until that is settled.
    // Both layers answer 429 and only the app sends a sentence or a Retry-After, so a
    // duration is never invented - nginx's window is one minute, the app's is fifteen.
    const tooManyRequestsMessage = (response) => {
        const retryAfterSeconds = Number(response.headers.get('Retry-After'));
        if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
            return 'Too many attempts. Please wait a moment, then try again.';
        }
        const minutes = Math.ceil(retryAfterSeconds / 60);
        return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            // See the same guard in auth.js: the nginx flood gate answers 429 with an
            // HTML error page, so parsing must not be allowed to throw.
            const responseData = await response.json().catch(() => ({}));

            if (response.ok) {
                showMessage(form, responseData.message, 'success');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else if (response.status === 429) {
                showMessage(form, responseData.error || tooManyRequestsMessage(response), 'error');
            } else {
                showMessage(form, responseData.error, 'error');
            }
        } catch (error) {
            showMessage(form, 'An error occurred. Please try again.', 'error');
        }
    });

    function showMessage(form, message, type) {
        const existingMessage = form.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        form.insertBefore(messageDiv, form.firstChild);
    }
});