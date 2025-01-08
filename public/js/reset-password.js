document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reset-password-form');

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

            const responseData = await response.json();

            if (response.ok) {
                showMessage(form, responseData.message, 'success');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
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