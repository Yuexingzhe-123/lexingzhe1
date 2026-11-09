/* Device-local IndexedDB with localStorage fallback, no account or server. */
const DB_NAME = 'cijian-pwa-v1';
const STORE = 'documents';
const STATE_KEY = 'learning-state';
const FALLBACK = 'cijian-pwa-fallback-v1';
let dbPromise;

function openDB() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('浏览器未提供 IndexedDB'));
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法开启本机数据库'));
  });
  return dbPromise;
}
export async function loadState() {
  try {
    const db = await openDB();
    const result = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return result || JSON.parse(localStorage.getItem(FALLBACK) || 'null');
  } catch {
    try { return JSON.parse(localStorage.getItem(FALLBACK) || 'null'); }
    catch { return null; }
  }
}
export async function saveState(state) {
  const plain = JSON.parse(JSON.stringify(state));
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(plain, STATE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (error) {
    try { localStorage.setItem(FALLBACK, JSON.stringify(plain)); return true; }
    catch { throw error; }
  }
}
