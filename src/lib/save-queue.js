const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = () => crypto.randomUUID();

// A session pointer isolates tabs; the actual journal survives reloads in
// localStorage. New journals prevent duplicated tabs overwriting each other.
export function draftJournal(boxId, storage, session) {
  const prefix = `bento.cat/draft/${boxId}/`, pointer = `bento.cat/draft-current/${boxId}`;
  let oldKey, oldRaw, loaded;
  try {
    oldKey = session?.getItem(pointer);
    if (oldKey?.startsWith(prefix)) {
      oldRaw = storage?.getItem(oldKey);
      loaded = JSON.parse(oldRaw || 'null');
      if (loaded?.version !== 1 || !loaded.data || !Number.isSafeInteger(loaded.revision)) loaded = null;
    }
  } catch { loaded = null; }
  const key = prefix + id();
  // Don't change the pointer until the new draft has actually been written.
  return {
    load: () => loaded,
    write(record) {
      try {
        if (!storage || !session) return false;
        storage.setItem(key, JSON.stringify({ ...record, version: 1, savedAt: Date.now() }));
        session.setItem(pointer, key);
        return true;
      } catch { return false; }
    },
    clear() {
      try {
        storage?.removeItem(key);
        if (oldKey && storage?.getItem(oldKey) === oldRaw) storage?.removeItem(oldKey);
        const current = session?.getItem(pointer);
        if (current === key || current === oldKey) session?.removeItem(pointer);
      } catch { /* best effort */ }
    },
  };
}

export const TYPING_PAUSE = 500;

export function createSaveQueue({ revision = 0, lastSaveId, getData, save, journal, onState = () => {}, onConflict = () => {}, onStorageError = () => {} }) {
  let pending = 0, inFlight = null, timer, disposed = false, paused = false, attempt = null, storageWarned = false, rejected = false, burst = false, urgent = false;
  const recovered = journal.load();
  let recovery = recovered?.data ? copy(recovered.data) : null;
  if (recovery) {
    pending = recovered.pending || 1;
    attempt = recovered.attempt || null;
    if (attempt && attempt.saveId === lastSaveId) {
      pending = Math.max(0, pending - attempt.count);
      if (!pending && same(recovery, attempt.data)) { recovery = null; journal.clear(); }
      attempt = null;
    } else if (recovered.revision !== revision) {
      // A reload must not rebase a conflicting draft onto the server revision.
      // Otherwise a second reload would silently turn the conflict into a save.
      paused = true;
      revision = recovered.revision;
    }
  }
  const persist = () => {
    if (!journal.write({ revision, data: copy(getData()), pending, attempt }) && !storageWarned) {
      storageWarned = true; onStorageError();
    }
  };
  function schedule(ms) {
    clearTimeout(timer);
    if (!disposed && !paused) timer = setTimeout(() => { void flush(false); }, ms);
  }
  // Keystrokes in a field are one change. The draft stays current on every key,
  // but the save waits for a pause in the typing, or for the field to let go.
  // Until then it's only 'typing': nothing is being saved yet.
  function changed({ typing = false } = {}) {
    if (rejected && !paused) { attempt = null; rejected = false; }
    if (!burst) pending++;
    burst = typing;
    persist();
    onState(paused ? 'error' : typing ? 'typing' : 'saving', pending);
    schedule(typing ? TYPING_PAUSE : 700);
  }
  async function drain() {
    while (pending && !paused) {
      // Keys typed after this snapshot are a new change.
      if (!attempt) burst = false;
      attempt ||= { data: copy(getData()), expectedRevision: revision, saveId: id(), count: pending };
      persist();
      onState('saving', pending);
      try {
        const { count, ...args } = attempt;
        const result = await save(copy(args));
        revision = result.revision;
        attempt = null;
        pending = Math.max(0, pending - count);
        if (!pending) journal.clear(); else persist();
        onState(pending ? 'saving' : 'saved', pending);
        // Still typing: let the burst pause before the next save, unless someone asked for it now.
        if (pending && burst && !urgent) { schedule(TYPING_PAUSE); break; }
      } catch (error) {
        rejected = error?.data !== undefined;
        if (error?.data?.code === 'SAVE_CONFLICT') {
          paused = true; persist(); onConflict();
        }
        onState('error', pending);
        schedule(4000);
        return false;
      }
    }
    return !paused;
  }
  // The timer flushes when a pause is due; anyone else (blur, leaving, logging out) wants it now.
  function flush(now = true) {
    clearTimeout(timer);
    if (now) urgent = true;
    if (paused) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = drain().finally(() => { inFlight = null; urgent = false; });
    return inFlight;
  }
  return {
    recovery, get paused() { return paused; }, get pending() { return pending; }, get inFlight() { return !!inFlight; },
    changed, flush,
    resume() { if (pending) { persist(); onState(paused ? 'error' : 'saving', pending); if (paused) onConflict(); else schedule(0); } },
    dispose() { disposed = true; clearTimeout(timer); if (pending) persist(); },
    discard() { paused = true; pending = 0; clearTimeout(timer); journal.clear(); },
  };
}
