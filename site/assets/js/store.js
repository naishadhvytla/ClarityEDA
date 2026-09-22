/* Clarity — tiny IndexedDB key/value store (restores your work after a refresh). */
const DB = 'clarity', STORE = 'kv';
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const idbGet = key => tx('readonly', s => s.get(key)).catch(() => null);
export const idbSet = (key, val) => tx('readwrite', s => s.put(val, key)).catch(() => null);
export const idbDel = key => tx('readwrite', s => s.delete(key)).catch(() => null);
