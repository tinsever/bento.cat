import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { TYPING_PAUSE, createSaveQueue, draftJournal } from '../src/lib/save-queue.js';

const copy = data => JSON.parse(JSON.stringify(data));
function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function setup(overrides = {}) {
  let data = { name: 'First', tiles: [] }, record = null;
  const save = vi.fn(async args => ({ revision: args.expectedRevision + 1 }));
  const journal = { load: () => null, write: value => { record = copy(value); return true; }, clear: () => { record = null; } };
  const queue = createSaveQueue({ revision: 0, getData: () => data, save, journal, ...overrides });
  return { queue, save, journal, get record() { return record; }, set data(value) { data = value; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('autosave recovery', () => {
  it('persists immediately, debounces network writes, and clears only after acknowledgment', async () => {
    const t = setup();
    t.queue.changed();
    expect(t.record.data.name).toBe('First');
    expect(t.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.record).toBeNull();
  });
  it('counts a run of keystrokes as one change and saves after the typing pauses', async () => {
    const states = [];
    const t = setup({ onState: (state, pending) => states.push(pending) });
    for (const name of ['F', 'Fi', 'Fir', 'Firs']) {
      t.data = { name, tiles: [] };
      t.queue.changed({ typing: true });
      expect(t.record.data.name).toBe(name);
      await vi.advanceTimersByTimeAsync(TYPING_PAUSE - 100);
    }
    expect(t.save).not.toHaveBeenCalled();
    expect(t.queue.pending).toBe(1);
    // Letting go of the field is the same change, saved without waiting for the pause.
    t.queue.changed();
    expect(t.queue.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(700);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls[0][0].data.name).toBe('Firs');
    expect(Math.max(...states)).toBe(1);
  });
  it('only reports saving once the typing pauses', async () => {
    const states = [];
    const t = setup({ onState: state => states.push(state) });
    t.queue.changed({ typing: true });
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE - 100);
    t.queue.changed({ typing: true });
    expect(states).toEqual(['typing', 'typing']);
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE);
    expect(states).toEqual(['typing', 'typing', 'saving', 'saved']);
  });
  it('saves keys typed while the previous burst is being saved', async () => {
    let resolve;
    const save = vi.fn(args => new Promise(r => { resolve = () => r({ revision: args.expectedRevision + 1 }); }));
    const t = setup({ save });
    t.queue.changed({ typing: true });
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE);
    expect(save).toHaveBeenCalledTimes(1);
    t.data = { name: 'Typed during the save', tiles: [] };
    t.queue.changed({ typing: true });
    resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(t.queue.pending).toBe(1);
    // The earlier save finishing doesn't cut the new burst short.
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE - 100);
    t.queue.changed({ typing: true });
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE - 100);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].data.name).toBe('Typed during the save');
  });
  it('still saves at once when asked to, even mid-burst', async () => {
    let resolve;
    const save = vi.fn(args => new Promise(r => { resolve = () => r({ revision: args.expectedRevision + 1 }); }));
    const t = setup({ save });
    t.queue.changed({ typing: true });
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE);
    t.queue.changed({ typing: true });
    const done = t.queue.flush();
    resolve(); await vi.advanceTimersByTimeAsync(0);
    resolve(); await done;
    expect(save).toHaveBeenCalledTimes(2);
    expect(t.queue.pending).toBe(0);
  });
  it('serializes edits made while a save is in flight', async () => {
    let resolve;
    const save = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ revision: 2 });
    const t = setup({ save });
    t.queue.changed(); const flush = t.queue.flush();
    t.data = { name: 'Second', tiles: [] }; t.queue.changed();
    expect(t.queue.flush()).toBe(flush);
    resolve({ revision: 1 }); await flush;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ expectedRevision: 1, data: { name: 'Second' } });
    expect(t.record).toBeNull();
  });
  it('retries the same save id after a lost response, then saves newer edits', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ revision: 1 }).mockResolvedValueOnce({ revision: 2 });
    const t = setup({ save }); t.queue.changed(); await t.queue.flush();
    t.data = { name: 'Second', tiles: [] }; t.queue.changed(); await t.queue.flush();
    expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
    expect(save.mock.calls[2][0]).toMatchObject({ expectedRevision: 1, data: { name: 'Second' } });
    expect(t.record).toBeNull();
  });
  it('preserves a conflicting draft and stops automatic overwrites', async () => {
    const conflict = Object.assign(new Error('stale'), { data: { code: 'SAVE_CONFLICT' } });
    const save = vi.fn().mockRejectedValue(conflict), onConflict = vi.fn();
    const t = setup({ save, onConflict }); t.queue.changed(); await t.queue.flush();
    t.data = { name: 'Still editing', tiles: [] }; t.queue.changed();
    await vi.advanceTimersByTimeAsync(10_000); await t.queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(t.record.data.name).toBe('Still editing');
    expect(onConflict).toHaveBeenCalledTimes(1);
  });
  it('restores pending changes after reload without overwriting a newer server revision', async () => {
    let record = { revision: 0, pending: 1, data: { name: 'Recovered' } };
    const save = vi.fn(), journal = { load: () => record, write: value => { record = copy(value); return true; }, clear: vi.fn() };
    const queue = createSaveQueue({ revision: 1, getData: () => record.data, journal, save });
    expect(queue.recovery.name).toBe('Recovered'); queue.resume();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled(); expect(queue.paused).toBe(true);
    expect(record.revision).toBe(0);
    const reloaded = createSaveQueue({ revision: 1, getData: () => record.data, journal, save });
    reloaded.resume(); await reloaded.flush();
    expect(reloaded.paused).toBe(true); expect(save).not.toHaveBeenCalled();
  });
  it('lets a corrected edit replace a definitively rejected save', async () => {
    const error = Object.assign(new Error('invalid data'), { data: 'Invalid data' });
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ revision: 1 });
    const t = setup({ save }); t.queue.changed(); await t.queue.flush();
    t.data = { name: 'Corrected', tiles: [] }; t.queue.changed(); await t.queue.flush();
    expect(save.mock.calls[1][0].data.name).toBe('Corrected');
    expect(save.mock.calls[1][0].saveId).not.toBe(save.mock.calls[0][0].saveId);
  });
  it('recognizes a server-acknowledged save after the tab lost its response', async () => {
    const record = { revision: 0, pending: 2, data: { name: 'Second' }, attempt: { saveId: 'accepted', expectedRevision: 0, data: { name: 'First' }, count: 1 } };
    const save = vi.fn(async () => ({ revision: 2 }));
    const journal = { load: () => record, write: () => true, clear: vi.fn() };
    const queue = createSaveQueue({ revision: 1, lastSaveId: 'accepted', getData: () => record.data, journal, save });
    queue.resume(); await queue.flush();
    expect(save.mock.calls[0][0]).toMatchObject({ expectedRevision: 1, data: { name: 'Second' } });
    expect(queue.paused).toBe(false);
  });
  it('keeps a draft when the editor unmounts during a failed save', async () => {
    const t = setup({ save: vi.fn().mockRejectedValue(new Error('offline')) });
    t.queue.changed(); t.queue.dispose(); await t.queue.flush();
    expect(t.record).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.queue.pending).toBe(1);
  });
  it('isolates duplicated tabs and tolerates disabled browser storage', () => {
    const storage = memory(), firstSession = memory();
    const first = draftJournal('box', storage, firstSession);
    first.write({ revision: 0, pending: 1, data: { name: 'First' } });
    const copiedSession = memory(); copiedSession.setItem('bento.cat/draft-current/box', firstSession.getItem('bento.cat/draft-current/box'));
    const second = draftJournal('box', storage, copiedSession);
    second.write({ revision: 0, pending: 1, data: { name: 'Second' } });
    first.write({ revision: 0, pending: 1, data: { name: 'Newer first' } });
    second.clear();
    expect(draftJournal('box', storage, firstSession).load().data.name).toBe('Newer first');
    expect(draftJournal('box', { setItem() { throw new Error('blocked'); } }, memory()).write({ data: {} })).toBe(false);
  });
  it('does not clear a reopened editor’s pointer when the previous save finishes late', () => {
    const storage = memory(), session = memory();
    const first = draftJournal('box', storage, session);
    first.write({ revision: 0, pending: 1, data: { name: 'First' } });
    const reopened = draftJournal('box', storage, session);
    reopened.write({ revision: 0, pending: 1, data: { name: 'New edit' } });
    first.clear();
    expect(draftJournal('box', storage, session).load().data.name).toBe('New edit');
  });
});
