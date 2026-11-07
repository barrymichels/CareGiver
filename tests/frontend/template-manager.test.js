const browserGlobals = ['document', 'window', 'fetch', 'confirm', 'FormData'];
let originalGlobals;
beforeEach(() => {
    originalGlobals = browserGlobals.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]);
});
afterEach(() => {
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
    }
});

// Exercise the real event handlers and API payloads with a minimal DOM boundary.
function editor() {
    const nodes = new Map();
    function node(key) {
        if (!nodes.has(key)) nodes.set(key, {
            innerHTML: '', textContent: '', open: false, handlers: {},
            classList: { toggle() {} }, children: [],
            appendChild(child) { this.children.push(child); },
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
    Object.assign(global, {
        document: { getElementById: id => node('#' + id), querySelector: node, createElement: tag => ({ tag }), addEventListener() {} },
        window: { addEventListener() {} }, fetch, confirm,
        FormData: class { constructor(data) { this.data = data; } get(k) { return this.data[k] ?? ''; } getAll(k) { return this.data[k] || []; } }
    });
    // Load through Jest so executed browser code is included in coverage.
    jest.isolateModules(() => require('../../public/js/template-manager'));
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

test('default result identifies updated and protected weeks, and permits refreshing the same default', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.fetch.mockResolvedValue({ ok: true, json: async () => ({ refreshedWeeks: ['2026-11-02'], protectedWeeks: ['2026-11-09'] }) });
    app.click('default'); await app.submit({});
    expect(app.node('#template-status').textContent).toContain('1 empty week updated');
    expect(app.node('#template-status').textContent).toContain('2026-11-09');
    expect(app.node('#template-status').children[0].href).toBe('/admin');
    expect(app.html()).toContain('Update empty weeks');
    app.click('default'); await app.submit({});
    expect(app.fetch).toHaveBeenCalledTimes(2);
});

test.each([
    [{ redirected: true }, 'session has expired'],
    [{ ok: true, json: async () => { throw new Error('HTML response'); } }, 'Unable to read'],
    [{ ok: false, json: async () => ({}) }, 'could not be saved']
])('a failed save preserves the draft and unlocks the editor (%j)', async (response, message) => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('remove-slot', { day: '0', slot: '0' });
    app.fetch.mockResolvedValueOnce(response);
    app.click('save'); await app.settle();
    expect(app.node('#template-status').textContent).toContain(message);
    expect(app.node('.template-manager').inert).toBe(false);
    expect(app.node('#draft-status').textContent).toContain('Unsaved');
    app.click('save'); await app.settle();
    expect(app.body().slots).toEqual([
        { day_of_week: 1, time: '5:00pm', label: 'Evening', slot_order: 0 }
    ]);
});

test('invalid slot edits remain in the dialog without changing the draft', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('add-slot', { day: '0' });
    await app.submit({ time: '08:00', label: 'Duplicate' });
    expect(app.node('#template-dialog .dialog-error').textContent).toContain('already exists');
    expect(app.node('#template-dialog').open).toBe(true);
    await app.submit({ time: '09:00', label: ' ' });
    expect(app.node('#template-dialog .dialog-error').textContent).toContain('label is required');
    app.click('save'); await app.settle();
    expect(app.body().slots).toHaveLength(2);
});

test('an empty template cannot be saved', async () => {
    const app = editor(); app.click('new');
    await app.submit({ name: 'New schedule' });
    app.click('save'); await app.settle();
    expect(app.fetch).not.toHaveBeenCalled();
    expect(app.node('#template-status').textContent).toContain('at least one timeslot');
});

test('deleting a non-default template calls the server and returns to the library', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('delete');
    expect(app.fetch).not.toHaveBeenCalled();
    await app.submit({});
    expect(app.fetch.mock.calls[0][0]).toBe('/admin/timeslot-templates/11');
    expect(app.fetch.mock.calls[0][1].method).toBe('DELETE');
    expect(app.body()).toEqual({ replacementDefaultId: null });
    expect(app.node('#template-status').textContent).toContain('Template deleted');
    expect(app.html()).not.toContain('Routine');
});

test('the only default template cannot be deleted', async () => {
    const app = editor(); app.click('open', { id: '11' });
    app.click('default'); await app.submit({});
    app.fetch.mockClear();
    app.click('delete');
    expect(app.node('#template-status').textContent).toContain('Create another template');
    expect(app.fetch).not.toHaveBeenCalled();
});
