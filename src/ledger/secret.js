import { emptyLedger, validateLedger } from './model.js';

export const SECRET_STORAGE_KEY = 'ran-jin-ledger-secret:v1';
const KIND = 'ran-jin-secret-ledger';
const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const context = encoder.encode(`${KIND}:v1`);

function encode(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decode(value, size, max = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('加密备份格式不完整，原有数据未改变。');
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (bytes.length < size || bytes.length > max) throw new Error('加密备份格式不完整，原有数据未改变。');
  return bytes;
}
export function validateSecretBackup(value) {
  if (!value || value.kind !== KIND || value.version !== 1 || value.iterations !== ITERATIONS) throw new Error('请选择秘密基地导出的加密 JSON 备份。');
  decode(value.salt, 16); decode(value.iv, 12); decode(value.data, 16, 6 * 1024 * 1024);
  return { kind: KIND, version: 1, iterations: ITERATIONS, salt: value.salt, iv: value.iv, data: value.data };
}
async function deriveKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('此浏览器不支持安全加密，请使用最新版浏览器并通过 HTTPS 打开。');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('密码需要 8–128 个字符。');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: decode(salt, 16), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function decrypt(envelope, key) {
  let bytes;
  try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv, 12), additionalData: context }, key, decode(envelope.data, 16, 6 * 1024 * 1024)); }
  catch { throw new Error('密码不正确，或加密数据已损坏。原有数据未改变。'); }
  return validateLedger(JSON.parse(new TextDecoder().decode(bytes)));
}
async function encrypt(ledger, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, encoder.encode(JSON.stringify(validateLedger(ledger))));
  return { kind: KIND, version: 1, iterations: ITERATIONS, salt, iv: encode(iv), data: encode(new Uint8Array(bytes)) };
}
export async function decryptSecretBackup(value, password) {
  const envelope = validateSecretBackup(value);
  return decrypt(envelope, await deriveKey(password, envelope.salt));
}

// The password and plaintext are never written to storage. Each save reads the
// latest encrypted state and checks it again after asynchronous encryption.
export async function openSecretLedger(storage, password, { create = false, backup = null, signal, expectedRaw } = {}) {
  const original = storage.getItem(SECRET_STORAGE_KEY);
  if (expectedRaw !== undefined && original !== expectedRaw) throw new Error('秘密基地已在其他窗口更改，请关闭后重新进入。');
  if (create && original !== null) throw new Error('秘密基地已存在，请使用原密码进入，原有数据不会被覆盖。');
  if (!create && !backup && original === null) throw new Error('未找到秘密基地，请先设置密码。');
  const envelope = backup ? validateSecretBackup(backup) : create ? null : validateSecretBackup(JSON.parse(original));
  const salt = envelope?.salt || encode(crypto.getRandomValues(new Uint8Array(16)));
  let key = await deriveKey(password, salt);
  const ledger = envelope ? await decrypt(envelope, key) : emptyLedger();
  const initial = create ? JSON.stringify(await encrypt(ledger, key, salt)) : backup ? JSON.stringify(envelope) : original;
  signal?.throwIfAborted();
  if (storage.getItem(SECRET_STORAGE_KEY) !== original) throw new Error('秘密基地已在其他窗口更改，请重新进入。');
  if (create || backup) storage.setItem(SECRET_STORAGE_KEY, initial);
  let locked = false;
  function assertOpen() { if (locked) throw new Error('秘密基地已锁定，请重新进入。'); }
  return {
    ledger,
    lock() { locked = true; key = null; this.ledger = null; },
    async update(transform) {
      assertOpen();
      const previous = storage.getItem(SECRET_STORAGE_KEY);
      if (previous === null) throw new Error('秘密基地已被移除，请退出后重新进入。');
      const latest = validateSecretBackup(JSON.parse(previous));
      if (latest.salt !== salt) throw new Error('秘密基地已在其他窗口恢复，请退出后重新进入。');
      const current = await decrypt(latest, key);
      assertOpen();
      const next = validateLedger(transform(current));
      const raw = JSON.stringify(await encrypt(next, key, salt));
      assertOpen();
      if (storage.getItem(SECRET_STORAGE_KEY) !== previous) throw new Error('其他窗口刚刚修改了秘密基地，本次未保存，请重新进入后再试。');
      storage.setItem(SECRET_STORAGE_KEY, raw);
      return next;
    },
  };
}
