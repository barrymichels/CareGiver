document.addEventListener('DOMContentLoaded', () => {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const forms = document.querySelectorAll('.form');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and forms
            tabBtns.forEach(b => b.classList.remove('active'));
            forms.forEach(f => f.classList.remove('active'));

            // Add active class to clicked button and corresponding form
            btn.classList.add('active');
            const formId = `${btn.dataset.form}-form`;
            document.getElementById(formId).classList.add('active');
        });
    });

    // Two layers can answer 429 and only the app sends a sentence: the nginx flood
    // gate replies with an openresty HTML page and sets no Retry-After. So the wait
    // length is read from the header when it exists and is never invented when it
    // does not - claiming "15 minutes" for a one-minute nginx refusal would be a lie.
    const tooManyRequestsMessage = (response) => {
        const retryAfterSeconds = Number(response.headers.get('Retry-After'));
        if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
            return 'Too many attempts. Please wait a moment, then try again.';
        }
        const minutes = Math.ceil(retryAfterSeconds / 60);
        return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    };

    // Handle form submissions
    const handleSubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
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

            // An unguarded response.json() here is what made a flood-gate refusal
            // indistinguishable from a crash: HTML makes it throw, the catch below
            // answers "An error occurred. Please try again.", and that message invites
            // the exact retry that was just refused.
            const responseData = await response.json().catch(() => ({}));
            
            if (response.ok) {
                if (responseData.redirect) {
                    window.location.href = responseData.redirect;
                } else if (form.id === 'register-form') {
                    showMessage(form, responseData.message, 'success');
                    document.querySelector('[data-form="login"]').click();
                    form.reset();
                }
            } else if (response.status === 429) {
                showMessage(form, responseData.error || tooManyRequestsMessage(response), 'error');
            } else {
                showMessage(form, responseData.error || responseData.message, 'error');
            }
        } catch (error) {
            showMessage(form, 'An error occurred. Please try again.', 'error');
        }
    };

    const showMessage = (form, message, type) => {
        // Remove any existing message
        const existingMessage = form.querySelector('.message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Create and insert new message
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;
        form.insertBefore(messageDiv, form.firstChild);

        // Remove message after 5 seconds
        setTimeout(() => messageDiv.remove(), 5000);
    };

    document.getElementById('login-form').addEventListener('submit', handleSubmit);
    document.getElementById('register-form').addEventListener('submit', handleSubmit);
}); 