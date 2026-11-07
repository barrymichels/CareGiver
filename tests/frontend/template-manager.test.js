const fs = require('fs');
const vm = require('vm');

// Exercise the real event handlers and API payloads with a minimal DOM boundary.
function editor() {
    const nodes = new Map();
    function node(key) {
        if (!nodes.has(key)) nodes.set(key, {
            innerHTML: '', textContent: '', open: false, handlers: {},
            classList: { toggle() {} },
            querySelector: selector => node(`${key} ${selector}`), querySelectorAll: () => [],
            addEventListener(type, handler) { this.handlers[type] = handler; },
            showModal() { this.open = true; }, close() { this.open = false; }
        });
        return nodes.get(key);
    }
    node('#template-data').textContent = JSON.stringify([{ template: { id: 11, name: 'Routine', is_default: 0 },
        slots: { 0: [{ time: '8:00am', label: 'Morning' }], 1: [{ time: '5:00pm', label: 'Evening' }] } }]);
    const fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    const confirm = jest.fn(() => true);
    vm.runInNewContext(fs.readFileSync('public/js/template-manager.js', 'utf8'), {
        document: { getElementById: id => node('#' + id), querySelector: node, addEventListener() {} },
        window: { addEventListener() {} }, fetch, confirm,
        FormData: class { constructor(data) { this.data = data; } get(k) { return this.data[k] ?? ''; } getAll(k) { return this.data[k] || []; } }
    });
    function click(action, data = {}) {
        node('.template-manager').handlers.click({ target: { closest: () => ({ dataset: { action, ...data } }) } });
    }
    const submit = data => node('#template-dialog form').onsubmit({ preventDefault() {}, target: data });
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const body = () => JSON.parse(fetch.mock.calls.at(-1)[1].body);
    const html = () => node('#template-workspace').innerHTML;
    return { click, submit, settle, body, html, fetch, confirm, node };
}

test('editing and saving updates the same template; failed saves retain the draft', async () => {
    const app = editor();
    app.click('open', { id: '11' });
    app.click('edit-slot', { day: '0', slot: '0' });
    await app.submit({ time: '13:30', label: 'Afternoon' });
    app.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Save failed' }) });
    app.click('save'); await app.settle();
    expect(app.html()).toContain('1:30pm');
    expect(app.node('#template-status').textContent).toBe('Save failed');
    app.click('save'); await app.settle();
    expect(app.fetch.mock.calls.at(-1)[0]).toBe('/admin/timeslot-templates/11');
    expect(app.fetch.mock.calls.at(-1)[1].method).toBe('PUT');
    expect(app.body().slots).toEqual([
        { day_of_week: 0, time: '1:30pm', label: 'Afternoon', slot_order: 0 },
        { day_of_week: 1, time: '5:00pm', label: 'Evening', slot_order: 0 }
    ]);
    expect(app.node('#draft-status').textContent).toBe('All changes saved');
});

test('copying selected days leaves other days alone, then duplicate creates a new template', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('copy', { day: '0' }); await app.submit({ target: ['2', '3'] });
    app.click('duplicate'); await app.submit({ name: 'Copy', description: 'Different days' });
    app.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 12, is_default: false } }) });
    app.click('save'); await app.settle();
    expect(app.fetch.mock.calls[0][0]).toBe('/admin/timeslot-templates');
    expect(app.fetch.mock.calls[0][1].method).toBe('POST');
    expect(app.body().slots.map(slot => [slot.day_of_week, slot.time])).toEqual([
        [0, '8:00am'], [1, '5:00pm'], [2, '8:00am'], [3, '8:00am']
    ]);
    app.click('library'); app.click('open', { id: '11' });
    expect(app.html()).toContain('Routine');
    expect((app.html().match(/class="slot-time"/g) || []).length).toBe(2);
});

test('unsaved navigation can be cancelled and default promotion requires a clean saved template', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('remove-slot', { day: '0', slot: '0' });
    app.confirm.mockReturnValue(false);
    app.click('library'); expect(app.html()).toContain('EDITING TEMPLATE');
    app.click('default'); expect(app.fetch).not.toHaveBeenCalled();
    expect(app.node('#template-status').textContent).toContain('Save or discard');
    app.confirm.mockReturnValue(true); app.click('discard'); app.click('default');
    await app.submit({});
    expect(app.fetch.mock.calls[0][0]).toBe('/admin/timeslot-templates/11/set-default');
});
