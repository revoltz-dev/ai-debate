import { useEffect, useMemo, useSyncExternalStore } from 'react';

const queues = new Map();
const encode = value => JSON.stringify(value);

function serialize(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(key, current);
  current.finally(() => { if (queues.get(key) === current) queues.delete(key); }).catch(() => {});
  return current;
}

function createAutosave(key, initial, options) {
  let configuration = options, value = initial, saved = encode(initial);
  let revision = 0, queuedRevision = -1, failedRevision = -1, dirty = false, jobs = 0, timer = null;
  let latest = Promise.resolve(), snapshot = { value, error: '', pending: false };
  const listeners = new Set();
  const validate = candidate => configuration.validate?.(candidate) || '';
  const publish = patch => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const flush = () => {
    clear();
    const error = validate(value);
    if (configuration.enabled === false || error || !dirty) {
      if (error !== snapshot.error || snapshot.pending !== (jobs > 0)) publish({ error, pending: jobs > 0 });
      return latest;
    }
    if (queuedRevision === revision && failedRevision !== revision) return latest;
    const submitted = value, submittedKey = encode(submitted), submittedRevision = revision, onSave = configuration.onSave;
    queuedRevision = submittedRevision; failedRevision = -1; jobs++;
    publish({ pending: true, error: '' });
    latest = serialize(key, () => onSave(submitted)).then(result => {
      saved = submittedKey;
      if (revision === submittedRevision) {
        dirty = false;
        publish({ error: '' });
      }
      return result;
    }).catch(error => {
      if (revision === submittedRevision) {
        failedRevision = submittedRevision;
        publish({ error: error?.message || String(error) });
      }
      throw error;
    }).finally(() => {
      jobs--;
      publish({ pending: jobs > 0 || dirty && !snapshot.error && timer !== null });
    });
    latest.catch(() => {});
    return latest;
  };
  return {
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    configure: next => { configuration = next; },
    acceptRemote: next => {
      const remote = encode(next);
      if (dirty || jobs > 0) return;
      saved = remote;
      if (encode(value) !== remote) { value = next; publish({ value, error: '', pending: false }); }
    },
    setValue: next => {
      value = typeof next === 'function' ? next(value) : next;
      revision++; failedRevision = -1; clear();
      dirty = encode(value) !== saved || jobs > 0;
      const error = validate(value);
      publish({ value, error, pending: jobs > 0 || dirty && !error && configuration.enabled !== false });
      if (dirty && !error && configuration.enabled !== false) timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, configuration.delay ?? 500);
    },
    flush,
    release: () => { clear(); flush().catch(() => {}); }
  };
}

export function useAutosave({ key, value, onSave, delay = 500, validate, enabled = true }) {
  const controller = useMemo(() => createAutosave(key, value, { onSave, delay, validate, enabled }), [key]);
  controller.configure({ onSave, delay, validate, enabled });
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const remote = encode(value);
  useEffect(() => { controller.acceptRemote(value); }, [controller, remote]);
  useEffect(() => () => controller.release(), [controller]);
  return { ...snapshot, setValue: controller.setValue, flush: controller.flush };
}
