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

            const responseData = await response.json();
            
            if (response.ok) {
                if (responseData.redirect) {
                    window.location.href = responseData.redirect;
                } else if (form.id === 'register-form') {
                    showMessage(form, responseData.message, 'success');
                    document.querySelector('[data-form="login"]').click();
                    form.reset();
                }
            } else {
                showMessage(form, responseData.error, 'error');
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