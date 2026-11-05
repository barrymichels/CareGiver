document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgot-password-form');

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
                showMessage(form, 'If this email is registered, you will receive password reset instructions shortly.', 'success');
                form.reset();
            } else if (response.status === 429) {
                // A refused request must never look like "an email is on its way":
                // the sender would wait an hour for a mail that was never queued.
                const body = await response.json().catch(() => ({}));
                showMessage(form, body.error || 'Too many attempts. Please wait a while and try again.', 'error');
            } else {
                // Deliberately identical to the success line for every other
                // failure: this form must not reveal whether an address exists.
                showMessage(form, 'If this email is registered, you will receive password reset instructions shortly.', 'success');
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