import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECORDS, STORAGE_KEY, emptyLedger, parseMoney, formatMoney, validDate, validMonth, shiftMonth, validateLedger, monthlySummary, filteredTransactions, expenseCategories, mergeLedgers, transactionsCsv } from '../src/ledger/model.js';
import { readLedger, updateLedger, replaceLedger } from '../src/ledger/storage.js';

const entry = (overrides = {}) => ({ id: 'record-1', type: 'expense', amount: 10, category: 'food', date: '2026-10-14', account: 'wechat', note: '午餐', createdAt: 1, ...overrides });
const state = transactions => ({ version: 1, transactions, budgets: {} });
function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: key => key === STORAGE_KEY ? value : null, setItem: (key, next) => { if (key === STORAGE_KEY) value = next; } };
}

test('decimal money becomes exact integer cents', () => {
  assert.equal(parseMoney('0.10'), 10);
  assert.equal(parseMoney('0.2'), 20);
  assert.equal(parseMoney(' 12.30 '), 1230);
  assert.equal(parseMoney('9999999.99'), 999999999);
  assert.equal(formatMoney(30), '¥0.30');
});
test('invalid, negative, zero, scientific and over-precision amounts are rejected', () => {
  for (const value of ['', '0', '0.00', '-1', '+2', '1e3', '12.345', '10000000', 'NaN', '1,000', '.5']) assert.throws(() => parseMoney(value), Error, value);
});
test('calendar dates and month shifts handle leap days and year boundaries', () => {
  assert.equal(validDate('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01']) assert.equal(validDate(value), false, value);
  assert.equal(validMonth('2026-10'), true);
  assert.equal(validMonth('2026-00'), false);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('0001-01', -1), '0001-01');
});
test('monthly totals use exact cents and exclude other months', () => {
  const records = [entry(), entry({ id: 'record-2', amount: 20 }), entry({ id: 'salary', type: 'income', category: 'salary', amount: 100 }), entry({ id: 'old', amount: 999, date: '2026-09-01' })];
  assert.deepEqual(monthlySummary(records, '2026-10'), { income: 100, expense: 30, balance: 70, count: 3 });
  assert.equal(monthlySummary(records, '2026-11').count, 0);
});
test('category totals combine repeated expenses and exclude income', () => {
  const records = [entry({ amount: 100 }), entry({ id: 'second', amount: 200 }), entry({ id: 'travel', category: 'transport', amount: 50 }), entry({ id: 'salary', type: 'income', category: 'salary', amount: 500 })];
  assert.deepEqual(expenseCategories(records, '2026-10').map(item => [item.id, item.amount]), [['food', 300], ['transport', 50]]);
});
test('filters combine month, type, category and literal search', () => {
  const records = [entry(), entry({ id: 'travel', category: 'transport', note: '地铁', amount: 300 }), entry({ id: 'old', date: '2026-09-14' })];
  assert.deepEqual(filteredTransactions(records, { month: '2026-10', type: 'expense', category: 'transport', search: '地铁' }).map(item => item.id), ['travel']);
  assert.equal(filteredTransactions(records, { month: '2026-10', search: '微信' }).length, 2);
  assert.equal(filteredTransactions(records, { month: '2026-10', search: '<script>' }).length, 0);
});
test('sorting chooses the requested date or amount order', () => {
  const records = [entry({ id: 'a', amount: 100, date: '2026-10-01' }), entry({ id: 'b', amount: 300, date: '2026-10-02' }), entry({ id: 'c', amount: 200, date: '2026-10-03' })];
  assert.deepEqual(filteredTransactions(records, { month: '2026-10', sort: 'largest' }).map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(filteredTransactions(records, { month: '2026-10', sort: 'oldest' }).map(item => item.id), ['a', 'b', 'c']);
});
test('backup validation rejects mismatched types, unsafe amounts and bad dates', () => {
  for (const invalid of [{ amount: 1.1 }, { amount: -10 }, { amount: Number.MAX_SAFE_INTEGER }, { type: 'income', category: 'food' }, { date: '2026-02-30' }, { account: '__proto__' }, { note: 'a'.repeat(121) }]) assert.throws(() => validateLedger(state([entry(invalid)])));
});
test('backup validation rejects duplicate identifiers and oversized ledgers', () => {
  assert.throws(() => validateLedger(state([entry(), entry()])));
  assert.throws(() => validateLedger(state(Array.from({ length: MAX_RECORDS + 1 }, (_, index) => entry({ id: `r-${index}` })))));
});
test('backup version and budget data are validated atomically', () => {
  assert.throws(() => validateLedger({ ...emptyLedger(), version: 2 }));
  assert.throws(() => validateLedger({ ...emptyLedger(), budgets: { '2026-10': 0 } }));
  assert.throws(() => validateLedger({ ...emptyLedger(), budgets: JSON.parse('{"__proto__":100}') }));
  assert.throws(() => validateLedger({ ...emptyLedger(), budgets: { '2026-13': 100 } }));
  assert.deepEqual(validateLedger({ ...emptyLedger(), exportedAt: 'metadata', budgets: { '2026-10': 200 } }).budgets, { '2026-10': 200 });
});
test('merging backups preserves existing edits and budgets, and is repeatable', () => {
  const existing = { ...state([entry({ note: '已编辑' })]), budgets: { '2026-10': 10000 } };
  const imported = { ...state([entry(), entry({ id: 'new' })]), budgets: { '2026-10': 20000, '2026-11': 30000 } };
  const merged = mergeLedgers(existing, imported);
  assert.equal(merged.transactions.length, 2);
  assert.equal(merged.transactions[0].note, '已编辑');
  assert.deepEqual(merged.budgets, { '2026-10': 10000, '2026-11': 30000 });
  assert.deepEqual(mergeLedgers(merged, imported), merged);
});
test('CSV preserves quotes and newlines while neutralizing spreadsheet formulas', () => {
  const csv = transactionsCsv([entry({ note: '=HYPERLINK("https://example.com")' }), entry({ id: 'two', note: '  +SUM(1,2)' }), entry({ id: 'three', note: '咖啡,"小杯"\n下午' })]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"\'  +SUM(1,2)"'));
  assert.ok(csv.includes('"咖啡,""小杯""\n下午"'));
  assert.ok(csv.includes('"0.10"'));
});
test('saving reads the latest stored state instead of replacing other-tab records', () => {
  const storage = memoryStorage(JSON.stringify(state([entry()])));
  const updated = updateLedger(storage, current => ({ ...current, transactions: [...current.transactions, entry({ id: 'next' })] }));
  assert.equal(updated.transactions.length, 2);
  assert.deepEqual(readLedger(storage), updated);
});
test('failed storage writes leave the previous ledger intact', () => {
  const previous = JSON.stringify(state([entry()]));
  const storage = { getItem: () => previous, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  assert.throws(() => updateLedger(storage, current => ({ ...current, transactions: [] })), { name: 'QuotaExceededError' });
  assert.equal(storage.getItem(), previous);
});
test('malformed storage is not silently overwritten', () => {
  let raw = '{invalid json';
  const storage = { getItem: () => raw, setItem: value => { raw = value; } };
  assert.throws(() => updateLedger(storage, () => emptyLedger()));
  assert.equal(raw, '{invalid json');
});
test('an explicitly confirmed replacement can recover a broken backup', () => {
  const storage = memoryStorage('{invalid');
  const result = replaceLedger(storage, state([entry()]));
  assert.deepEqual(readLedger(storage), result);
});
