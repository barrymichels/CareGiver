/* Template drafts are independent of every saved week. Only explicit saves persist edits. */
(() => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const clone = value => JSON.parse(JSON.stringify(value));
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const normalize = ({ template, slots }) => ({
        id: template.id, name: template.name, description: template.description || '',
        is_default: Boolean(template.is_default),
        days: days.map((_, i) => (slots[i] || []).map(({ time, label }) => ({ time, label })))
    });
    let templates = JSON.parse(document.getElementById('template-data').textContent).map(normalize);
    let draft = null, savedDraft = null, busy = false;
    const workspace = document.getElementById('template-workspace');
    const dialog = document.getElementById('template-dialog');
    const status = document.getElementById('template-status');
    const dirty = () => draft && JSON.stringify(draft) !== JSON.stringify(savedDraft);
    const abandon = () => !dirty() || confirm('Discard unsaved changes to this template?');
    const badge = template => template.is_default ? ' <span class="badge">Default</span>' : '';
    function message(text, error = false) {
        status.textContent = text;
        status.classList.toggle('error', error);
    }
    function updateStatus() {
        workspace.querySelectorAll('[data-action=save],[data-action=discard]').forEach(button => {
            button.disabled = busy || !dirty();
        });
        const label = document.getElementById('draft-status');
        if (label) label.textContent = dirty() ? 'Unsaved changes' : 'All changes saved';
    }
    function openTemplate(id) {
        if (!abandon()) return;
        draft = clone(templates.find(template => template.id === id));
        savedDraft = clone(draft);
        message('');
        render();
    }
    function dayEditor(day) {
        return `<section class="day-column"><h3 class="day-header">${days[day]}</h3><div class="day-slots">${draft.days[day].map((slot, index) => `
            <div class="timeslot-item"><div class="slot-info"><div class="slot-time">${escape(slot.time)}</div><div class="slot-label">${escape(slot.label)}</div></div>
            <div class="slot-actions"><button class="edit-slot" aria-label="Edit ${days[day]} visit ${index + 1}" data-action="edit-slot" data-day="${day}" data-slot="${index}">✏️</button><button class="delete-slot" aria-label="Remove ${days[day]} visit ${index + 1}" data-action="remove-slot" data-day="${day}" data-slot="${index}">✕</button></div></div>`).join('')}
            <button class="add-slot-btn" data-action="add-slot" data-day="${day}">+ Add Timeslot</button>
            <button class="copy-day-btn" data-action="copy-all" data-day="${day}">📋 Copy to All Days</button>
            <button class="copy-day-btn" data-action="copy" data-day="${day}">Copy to selected days…</button></div></section>`;
    }
    function render() {
        if (!draft) {
            workspace.innerHTML = `<section class="panel" aria-label="Templates"><div class="template-row list-head"><span>Template</span><span>Daily visits · Mon–Sun</span><span>Action</span></div>${templates.map(template => `
                <article class="template-row"><div><h2>${escape(template.name)}${badge(template)}</h2><p class="muted">${escape(template.description)}</p></div>
                <div class="summary">${template.days.map((slots, i) => `<span>${days[i].slice(0, 3)} ${slots.length}</span>`).join('')}</div>
                <button class="primary" data-action="open" data-id="${template.id}" aria-label="Edit ${escape(template.name)}">Edit template →</button></article>`).join('') || '<p>No templates yet. Create a template to get started.</p>'}</section>`;
            return;
        }
        workspace.innerHTML = `<button data-action="library">← All templates</button>
            <section class="editor-top"><div class="row spread"><div><span class="muted">EDITING TEMPLATE</span><h2>${escape(draft.name)}${badge(draft)}</h2></div>
            <div class="row"><button data-action="discard">Discard changes</button><button class="primary" data-action="save">Save changes</button></div></div>
            <p class="muted">${escape(draft.description)}</p><div class="row template-actions">
            <button data-action="details">Edit name & description</button><button data-action="duplicate">Duplicate…</button>
            <button data-action="default" ${!draft.id ? 'disabled' : ''}>${draft.is_default ? 'Update empty weeks' : 'Make default'}</button>
            <button class="danger" data-action="delete" ${!draft.id ? 'disabled' : ''}>Delete…</button></div></section>
            <p class="muted"><span id="draft-status"></span> · Saving updates this template only. Existing weeks stay unchanged.</p>
            <div class="timeslot-grid">${days.map((_, i) => dayEditor(i)).join('')}</div>
            <div class="save-config-section"><button class="save-config-btn" data-action="save">Save changes</button><button data-action="discard">Discard changes</button></div>`;
        updateStatus();
    }
    async function request(url, method = 'GET', body) {
        const response = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (response.redirected) throw new Error('Your session has expired. Reload and sign in again.');
        let result;
        try { result = await response.json(); } catch { throw new Error('Unable to read the server response. Please try again.'); }
        if (!response.ok) throw new Error(result.error || 'The change could not be saved.');
        return result;
    }
    async function perform(action) {
        if (busy) return;
        busy = true;
        document.querySelector('.template-manager').inert = true;
        const fieldset = dialog.querySelector('fieldset');
        if (fieldset) fieldset.disabled = true;
        try {
            await action();
            return true;
        } catch (error) {
            message(error.message, true);
            const errorLabel = dialog.querySelector('.dialog-error');
            if (dialog.open && errorLabel) errorLabel.textContent = error.message;
            return false;
        } finally {
            busy = false;
            document.querySelector('.template-manager').inert = false;
            if (fieldset) fieldset.disabled = false;
            updateStatus();
        }
    }
    function showDialog(title, body, label, onSubmit) {
        dialog.innerHTML = `<form><fieldset><h2 id="dialog-title">${escape(title)}</h2>${body}<p class="dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${escape(label)}</button></div></fieldset></form>`;
        dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
        dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            if (busy) return;
            try {
                if (await onSubmit(new FormData(event.target)) !== false) dialog.close();
            } catch (error) {
                dialog.querySelector('.dialog-error').textContent = error.message;
            }
        };
        dialog.showModal();
    }
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    function editDetails(mode) {
        if (mode === 'new' && !abandon()) return;
        const name = mode === 'new' ? '' : draft.name + (mode === 'duplicate' ? ' copy' : '');
        const description = mode === 'new' ? '' : draft.description;
        showDialog(mode === 'details' ? 'Edit template details' : mode === 'new' ? 'Create template' : 'Duplicate template',
            `<label>Template name<input name="name" required maxlength="200" value="${escape(name)}"></label><label>Description (optional)<input name="description" maxlength="1000" value="${escape(description)}"></label>${mode === 'duplicate' ? '<p>The copy includes your current edits. Save it when ready.</p>' : ''}`, 'Continue', form => {
                const name = String(form.get('name')).trim();
                if (!name) throw new Error('Template name is required.');
                if (mode !== 'details') {
                    const slots = mode === 'duplicate' ? clone(draft.days) : days.map(() => []);
                    draft = { id: null, name, description: '', is_default: false, days: slots };
                    savedDraft = null;
                }
                draft.name = name;
                draft.description = String(form.get('description')).trim();
                render();
                message('Edit your draft, then Save changes to keep it.');
            });
    }
    function to24(time) {
        const [, hour, minute, period] = time.match(/^(\d+):(\d+)(am|pm)$/i);
        return `${String(+hour % 12 + (period.toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute}`;
    }
    function to12(time) {
        const [hour, minute] = time.split(':');
        return `${+hour % 12 || 12}:${minute}${+hour >= 12 ? 'pm' : 'am'}`;
    }
    function editSlot(day, index) {
        const slot = index === null ? { time: '', label: '' } : draft.days[day][index];
        showDialog(`${index === null ? 'Add' : 'Edit'} Timeslot · ${days[day]}`,
            `<label>Time<input type="time" name="time" required value="${slot.time ? to24(slot.time) : ''}"></label><label>Label<input name="label" required maxlength="200" value="${escape(slot.label)}" placeholder="Morning"></label>`, 'Update draft', form => {
                const time = to12(String(form.get('time')));
                const label = String(form.get('label')).trim();
                if (!label) throw new Error('A label is required.');
                if (draft.days[day].some((slot, i) => i !== index && to24(slot.time) === to24(time))) {
                    throw new Error('That time already exists on this day.');
                }
                if (index === null) draft.days[day].push({ time, label });
                else draft.days[day][index] = { time, label };
                draft.days[day].sort((a, b) => to24(a.time).localeCompare(to24(b.time)));
                render();
            });
    }
    async function save() {
        const slots = draft.days.flatMap((day, day_of_week) => day.map((slot, slot_order) => ({ ...slot, day_of_week, slot_order })));
        if (!slots.length) { message('Add at least one timeslot before saving.', true); return; }
        await perform(async () => {
            const result = await request(`/admin/timeslot-templates${draft.id ? '/' + draft.id : ''}`, draft.id ? 'PUT' : 'POST', {
                name: draft.name, description: draft.description, slots, isDefault: !templates.length
            });
            if (!draft.id) { draft.id = result.data.id; draft.is_default = Boolean(result.data.is_default); }
            const index = templates.findIndex(template => template.id === draft.id);
            if (index < 0) templates.push(clone(draft)); else templates[index] = clone(draft);
            savedDraft = clone(draft);
            render();
            message(`Saved “${draft.name}”. Existing weeks are unchanged.`);
        });
    }
    function defaultResult(result) {
        const refreshed = result.refreshedWeeks || [];
        const protectedWeeks = result.protectedWeeks || [];
        message(`Default updated. ${refreshed.length} empty week${refreshed.length === 1 ? '' : 's'} updated.` +
            (protectedWeeks.length ? ` Weeks beginning ${protectedWeeks.join(', ')} have saved availability or assignments and were left unchanged. Review them in the admin schedule.` : ' No weeks need review.'));
        if (protectedWeeks.length) {
            const link = document.createElement('a');
            link.href = '/admin';
            link.textContent = ' Open admin schedule';
            status.appendChild(link);
        }
    }
    function makeDefault() {
        if (dirty()) { message('Save or discard your changes before updating the default.', true); return; }
        showDialog(draft.is_default ? `Update empty weeks from “${draft.name}”?` : `Make “${draft.name}” the default?`,
            '',
            draft.is_default ? 'Update empty weeks' : 'Make default', () => perform(async () => {
                const result = await request(`/admin/timeslot-templates/${draft.id}/set-default`, 'POST');
                templates.forEach(template => { template.is_default = template.id === draft.id; });
                draft.is_default = true;
                savedDraft = clone(draft);
                render(); defaultResult(result);
            }));
    }
    function deleteTemplate() {
        const others = templates.filter(template => template.id !== draft.id);
        if (draft.is_default && !others.length) { message('Create another template before deleting the only default template.', true); return; }
        showDialog(`Delete “${draft.name}”?`, `<p>This removes the template and any unsaved edits. ${draft.is_default ? 'Empty current and future weeks will adopt the replacement default. Weeks with saved availability or assignments stay unchanged.' : 'Weeks already using it keep their saved times.'}</p>${draft.is_default ? `<label>Replacement default<select name="replacement">${others.map(template => `<option value="${template.id}">${escape(template.name)}</option>`).join('')}</select></label>` : ''}`, 'Delete template', form => perform(async () => {
            const replacementDefaultId = draft.is_default ? Number(form.get('replacement')) : null;
            const result = await request(`/admin/timeslot-templates/${draft.id}`, 'DELETE', { replacementDefaultId });
            templates = others;
            if (replacementDefaultId) templates.forEach(template => { template.is_default = template.id === replacementDefaultId; });
            draft = savedDraft = null;
            render();
            if (replacementDefaultId) defaultResult(result);
            else message('Template deleted. Existing weeks are unchanged.');
        }));
    }
    function copyDay(day, all) {
        showDialog(`Copy ${days[day]} ${all ? 'to all other days' : 'to selected days'}?`, `<p>This replaces the visits on the destination days. Save changes to keep the result.</p>${all ? '' : `<label><input type="checkbox" id="copy-all-days">All other days</label>${days.map((name, i) => i === day ? '' : `<label><input type="checkbox" name="target" value="${i}">${name}</label>`).join('')}`}`, 'Copy days', form => {
            const targets = all ? days.map((_, i) => i).filter(i => i !== day) : form.getAll('target').map(Number);
            if (!targets.length) throw new Error('Select at least one destination day.');
            targets.forEach(i => { draft.days[i] = clone(draft.days[day]); });
            render(); message(`Copied ${days[day]} to ${targets.map(i => days[i]).join(', ')}. Save changes to keep them.`);
        });
        if (!all) dialog.querySelector('#copy-all-days').onchange = event => {
            dialog.querySelectorAll('[name=target]').forEach(input => { input.checked = event.target.checked; });
        };
    }
    document.querySelector('.template-manager').addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button || busy) return;
        const day = Number(button.dataset.day), index = Number(button.dataset.slot);
        switch (button.dataset.action) {
            case 'open': openTemplate(Number(button.dataset.id)); break;
            case 'library': if (abandon()) { draft = savedDraft = null; render(); message(''); } break;
            case 'new': case 'duplicate': case 'details': editDetails(button.dataset.action); break;
            case 'discard': if (abandon()) { draft = clone(savedDraft); render(); message('Changes discarded.'); } break;
            case 'save': save(); break;
            case 'default': makeDefault(); break;
            case 'delete': deleteTemplate(); break;
            case 'add-slot': editSlot(day, null); break;
            case 'edit-slot': editSlot(day, index); break;
            case 'remove-slot': draft.days[day].splice(index, 1); render(); break;
            case 'copy': copyDay(day, false); break;
            case 'copy-all': copyDay(day, true); break;
        }
    });
    document.addEventListener('click', event => {
        if (event.target.closest('a[href]') && (busy || !abandon())) event.preventDefault();
    });
    window.addEventListener('beforeunload', event => {
        if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; }
    });
    render();
})();
