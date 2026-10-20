import { emptyWardrobe, validateWardrobe } from './model.js';

export const DATABASE_NAME = 'ran-jin-lolita:v1';
const STORE = 'wardrobe';
const KEY = 'archive';
let connection;
async function database() {
  if (!globalThis.indexedDB) throw new Error('浏览器不支持本地图片存储，请使用最新版浏览器。');
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他裙期页面后重试，本地数据库正在更新。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
  }).catch(error => { connection = null; throw error; });
  return connection;
}
export async function readRawWardrobe() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    tx.oncomplete = () => resolve(request.result ?? null);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法读取本地手账。'));
  });
}
export async function readWardrobe() {
  const raw = await readRawWardrobe();
  return raw === null ? emptyWardrobe() : validateWardrobe(raw);
}
// Reading, checking conflicts and writing share one readwrite transaction, so
// simultaneous edits in different tabs cannot silently overwrite each other.
export async function updateWardrobe(transform, { replace = false } = {}) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(KEY);
    let next; let failure;
    request.onsuccess = () => {
      try {
        const current = replace ? emptyWardrobe() : request.result === undefined ? emptyWardrobe() : validateWardrobe(request.result);
        next = validateWardrobe(transform(current));
        store.put(next, KEY);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('保存失败，原有手账未改变。'));
  });
}
