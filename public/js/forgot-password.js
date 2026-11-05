document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgot-password-form');

    // Shown for every outcome that must not disclose whether an address is registered.
    const MASKED_FEEDBACK = 'If this email is registered, you will receive password reset instructions shortly.';

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

            if (response.ok) {
                showMessage(form, MASKED_FEEDBACK, 'success');
                form.reset();
            } else if (response.status === 429) {
                // A refused request must never look like "an email is on its way":
                // the sender would wait an hour for a mail that was never queued.
                const body = await response.json().catch(() => ({}));
                showMessage(form, body.error || 'Too many attempts. Please wait a while and try again.', 'error');
            } else {
                // This route answers 400 only for "that is not an address"; an unknown
                // account gets the masked 200 instead. So relaying a 400 discloses
                // nothing about who is registered. Any other failure stays vague.
                const body = await response.json().catch(() => ({}));
                if (response.status === 400 && body.error) {
                    showMessage(form, body.error, 'error');
                } else {
                    showMessage(form, MASKED_FEEDBACK, 'success');
                }
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