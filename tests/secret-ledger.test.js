import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyLedger, monthlySummary, validateLedger } from '../src/ledger/model.js';
import { readLedger, updateLedger } from '../src/ledger/storage.js';
import { SECRET_STORAGE_KEY, openSecretLedger, decryptSecretBackup, validateSecretBackup } from '../src/ledger/secret.js';

const password = 'test-password-only-2026';
const entry = (id, amount = 12345) => ({ id, type: 'expense', amount, category: 'food', date: '2026-10-20', account: 'cash', note: '秘密记录内容', createdAt: 1 });
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('secret records, budgets and encrypted backups stay outside the ordinary ledger', async () => {
  const storage = memoryStorage();
  updateLedger(storage, state => ({ ...state, transactions: [entry('ordinary', 300)], budgets: { '2026-10': 10000 } }));
  const original = storage.getItem(STORAGE_KEY);
  const session = await openSecretLedger(storage, password, { create: true });
  await session.update(state => ({ ...state, transactions: [entry('private')], budgets: { '2026-10': 50000 } }));
  assert.equal(storage.getItem(STORAGE_KEY), original);
  assert.equal(monthlySummary(readLedger(storage).transactions, '2026-10').expense, 300);
  const raw = storage.getItem(SECRET_STORAGE_KEY);
  assert.ok(!raw.includes('秘密记录内容') && !raw.includes('private') && !raw.includes(password));
  const backup = JSON.parse(raw);
  assert.throws(() => validateLedger(backup));
  assert.equal((await decryptSecretBackup(backup, password)).transactions[0].id, 'private');
  session.lock();
  const reopened = await openSecretLedger(storage, password);
  assert.equal(reopened.ledger.budgets['2026-10'], 50000);
});

test('incorrect passwords, tampering and accidental setup never overwrite existing data', async () => {
  const storage = memoryStorage();
  await openSecretLedger(storage, password, { create: true });
  const raw = storage.getItem(SECRET_STORAGE_KEY);
  await assert.rejects(openSecretLedger(storage, 'incorrect-password'), /密码不正确/);
  await assert.rejects(openSecretLedger(storage, password, { create: true }), /已存在/);
  const changed = JSON.parse(raw);
  const bytes = Uint8Array.from(atob(changed.data), char => char.charCodeAt(0));
  bytes[0] ^= 1; changed.data = btoa(String.fromCharCode(...bytes));
  await assert.rejects(decryptSecretBackup(changed, password), /已损坏/);
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), raw);
});

test('each encrypted save reads the latest records and uses a fresh IV', async () => {
  const storage = memoryStorage();
  const first = await openSecretLedger(storage, password, { create: true });
  const second = await openSecretLedger(storage, password);
  const before = JSON.parse(storage.getItem(SECRET_STORAGE_KEY));
  await first.update(state => ({ ...state, transactions: [entry('one')] }));
  const after = JSON.parse(storage.getItem(SECRET_STORAGE_KEY));
  assert.notEqual(before.iv, after.iv);
  const result = await second.update(state => ({ ...state, transactions: [...state.transactions, entry('two')] }));
  assert.deepEqual(result.transactions.map(item => item.id), ['one', 'two']);
});

test('concurrent encrypted writes reject a stale save instead of losing records', async () => {
  const storage = memoryStorage();
  const first = await openSecretLedger(storage, password, { create: true });
  const second = await openSecretLedger(storage, password);
  const results = await Promise.allSettled([
    first.update(state => ({ ...state, transactions: [entry('one')] })),
    second.update(state => ({ ...state, transactions: [entry('two')] })),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await openSecretLedger(storage, password)).ledger.transactions.length, 1);
});

test('locking during a save and cancelling an unlock prevent subsequent writes', async () => {
  const storage = memoryStorage();
  const session = await openSecretLedger(storage, password, { create: true });
  const before = storage.getItem(SECRET_STORAGE_KEY);
  const pending = session.update(state => ({ ...state, transactions: [entry('never-saved')] }));
  session.lock();
  await assert.rejects(pending, /锁定/);
  await assert.rejects(session.update(() => emptyLedger()), /锁定/);
  assert.equal(session.ledger, null);
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), before);
  const other = memoryStorage();
  const controller = new AbortController();
  const opening = openSecretLedger(other, password, { create: true, signal: controller.signal });
  controller.abort();
  await assert.rejects(opening, { name: 'AbortError' });
  assert.equal(other.getItem(SECRET_STORAGE_KEY), null);
});

test('restoring encrypted backups works on a fresh browser without touching the total ledger', async () => {
  const source = memoryStorage();
  const session = await openSecretLedger(source, password, { create: true });
  await session.update(state => ({ ...state, transactions: [entry('restored')] }));
  const backup = JSON.parse(source.getItem(SECRET_STORAGE_KEY));
  const target = memoryStorage();
  updateLedger(target, state => ({ ...state, transactions: [entry('ordinary')] }));
  const original = target.getItem(STORAGE_KEY);
  const restored = await openSecretLedger(target, password, { backup });
  assert.equal(restored.ledger.transactions[0].id, 'restored');
  assert.equal(target.getItem(STORAGE_KEY), original);
  assert.throws(() => validateSecretBackup(emptyLedger()), /加密 JSON/);
});

test('invalid storage, quota failures and invalid edits preserve existing encrypted data', async () => {
  const storage = memoryStorage();
  const session = await openSecretLedger(storage, password, { create: true });
  const before = storage.getItem(SECRET_STORAGE_KEY);
  await assert.rejects(session.update(state => ({ ...state, transactions: [entry('invalid', -1)] })));
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), before);
  const full = { getItem: storage.getItem, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  const fullSession = await openSecretLedger(full, password);
  await assert.rejects(fullSession.update(() => emptyLedger()), { name: 'QuotaExceededError' });
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), before);
  storage.setItem(SECRET_STORAGE_KEY, '{broken');
  await assert.rejects(session.update(() => emptyLedger()));
  await assert.rejects(openSecretLedger(storage, password));
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), '{broken');
});

test('an outdated restore confirmation cannot replace another window’s new secret ledger', async () => {
  const storage = memoryStorage();
  await openSecretLedger(storage, password, { create: true });
  const backup = JSON.parse(storage.getItem(SECRET_STORAGE_KEY));
  await assert.rejects(openSecretLedger(storage, password, { backup, expectedRaw: null }), /其他窗口更改/);
  assert.equal(storage.getItem(SECRET_STORAGE_KEY), JSON.stringify(backup));
});
