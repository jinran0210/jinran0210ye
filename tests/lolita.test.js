import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWardrobe, validateOrder, validateWardrobe, mergeWardrobes, moneyInput, stageOf, timingLabel, summary, purchasedSummary, filteredOrders } from '../src/lolita/model.js';
import { wardrobeCalendar } from '../src/lolita/calendar.js';

const order = (overrides = {}) => ({ id: 'dress-1', title: '月光花园 JSK', shop: '测试店铺', variant: '白 / M', orderNumber: '123', note: '', deposit: 10000, depositDate: '2026-10-01', balance: 30000, balanceEstimated: true, startDate: '2026-10-20', endDate: '2026-10-25', remindDays: 7, status: 'pending', paidAmount: null, paidDate: '', photos: [], createdAt: 1, updatedAt: 1, ...overrides });
const archive = orders => ({ ...emptyWardrobe(), orders });
const paid = (overrides = {}) => order({ status: 'paid', paidAmount: 28000, paidDate: '2026-10-22', ...overrides });

test('amounts distinguish an unknown balance from a confirmed zero and retain exact cents', () => {
  assert.equal(moneyInput('', { optional: true }), null);
  assert.equal(moneyInput('0.00'), 0);
  assert.equal(moneyInput('0.10') + moneyInput('0.20'), 30);
  for (const invalid of ['', '-1', '1.001', '1e3', '10000000']) assert.throws(() => moneyInput(invalid));
});
test('orders validate date ranges and leap days without requiring a confirmed schedule', () => {
  assert.equal(validateOrder(order({ startDate: '', endDate: '', balance: null })).balance, null);
  assert.equal(validateOrder(order({ startDate: '2028-02-29', endDate: '2028-02-29' })).startDate, '2028-02-29');
  for (const changes of [{ endDate: '2026-10-19' }, { startDate: '' }, { startDate: '2026-02-29' }, { depositDate: '2026-04-31' }, { balance: -1 }, { balance: 1.1 }, { remindDays: 2 }, { status: '__proto__' }, { updatedAt: Number.MAX_SAFE_INTEGER }]) assert.throws(() => validateOrder(order(changes)));
});
test('payment completion requires actual amount and date rather than the estimated balance', () => {
  assert.equal(validateOrder(paid()).paidAmount, 28000);
  assert.throws(() => validateOrder(paid({ paidAmount: null })));
  assert.throws(() => validateOrder(paid({ paidDate: '' })));
  assert.throws(() => validateOrder(order({ paidAmount: 30000, paidDate: '2026-10-21' })));
});
test('reminders handle the inclusive start/end range and the configurable lead time', () => {
  const item = order();
  assert.equal(stageOf(item, '2026-10-12'), 'waiting');
  assert.equal(stageOf(item, '2026-10-13'), 'upcoming');
  assert.equal(stageOf(item, '2026-10-20'), 'open');
  assert.equal(stageOf(item, '2026-10-25'), 'open');
  assert.equal(stageOf(item, '2026-10-26'), 'overdue');
  assert.match(timingLabel(item, '2026-10-25'), /今天结束/);
  assert.match(timingLabel(item, '2026-10-26'), /预计结束日 1 天/);
  assert.equal(stageOf(order({ startDate: '', endDate: '' })), 'unscheduled');
  assert.equal(stageOf(paid(), '2027-01-01'), 'paid');
});
test('pending totals exclude paid/cancelled dresses and count each overlapping window once', () => {
  const orders = [order(), order({ id: 'unknown', balance: null, startDate: '', endDate: '' }), order({ id: 'later', balance: 50000, startDate: '2026-12-01', endDate: '2026-12-31' }), paid({ id: 'paid' }), order({ id: 'cancelled', status: 'cancelled' })];
  const result = summary(orders, '2026-10-20');
  assert.deepEqual(result.pending, { amount: 80000, unknown: 1, count: 3 });
  assert.deepEqual(result.open, { amount: 30000, unknown: 0, count: 1 });
  assert.deepEqual(result.soon, { amount: 30000, unknown: 0, count: 1 });
  assert.equal(result.unscheduled, 1);
  assert.equal(result.deposit, 40000);
});
test('purchased prices use deposit plus actual payment and never the preliminary estimate', () => {
  const orders = [paid(), paid({ id: 'second', deposit: 1000, balance: 99999, paidAmount: 2000 }), order({ id: 'pending' }), order({ id: 'cancelled', status: 'cancelled' })];
  assert.deepEqual(purchasedSummary(orders), { count: 2, deposit: 11000, balance: 30000, total: 41000 });
});
test('filters search literal notes and include schedules overlapping the selected month', () => {
  const orders = [order({ startDate: '2026-09-28', endDate: '2026-10-02', note: '店铺公告' }), order({ id: 'later', startDate: '2026-11-01', endDate: '2026-11-02' }), paid({ id: 'paid' })];
  assert.deepEqual(filteredOrders(orders, { month: '2026-10', search: '公告', view: 'pending' }).map(item => item.id), ['dress-1']);
  assert.equal(filteredOrders(orders, { search: '<script>' }).length, 0);
  assert.equal(filteredOrders(orders, { stage: 'overdue', view: 'pending' }, '2026-10-20').length, 1);
});
test('purchased filtering uses the actual payment month and sorting uses the actual total', () => {
  const orders = [paid({ id: 'first', paidDate: '2026-11-01', paidAmount: 1000 }), paid({ id: 'second', balance: 1, paidAmount: 50000 }), order({ id: 'pending' })];
  assert.deepEqual(filteredOrders(orders, { view: 'purchased', month: '2026-11' }).map(item => item.id), ['first']);
  assert.deepEqual(filteredOrders(orders, { view: 'purchased', sort: 'amount' }).map(item => item.id), ['second', 'first']);
});
test('backup validation rejects cross-tool imports, duplicate ids and invalid photos', () => {
  assert.throws(() => validateWardrobe({ version: 1, transactions: [], budgets: {} }));
  assert.throws(() => validateWardrobe(archive([order(), order()])));
  assert.throws(() => validateWardrobe(archive(Array.from({ length: 501 }, (_, i) => order({ id: `dress-${i}` })))));
  for (const data of ['https://example.com/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,AAAA']) assert.throws(() => validateOrder(order({ photos: [{ id: 'photo', kind: 'dress', data }] })));
});
test('merging backups preserves edited actual prices and is repeatable', () => {
  const current = archive([paid({ title: '我的已购裙子' })]);
  const backup = archive([order(), order({ id: 'new' })]);
  const merged = mergeWardrobes(current, backup);
  assert.equal(merged.orders.length, 2);
  assert.equal(merged.orders[0].paidAmount, 28000);
  assert.equal(merged.orders[0].title, '我的已购裙子');
  assert.deepEqual(mergeWardrobes(merged, backup), merged);
});
const unfolded = value => value.replaceAll('\r\n ', '');
test('calendar retains the inclusive window and alarms at 9 AM Beijing time', () => {
  const result = unfolded(wardrobeCalendar([order()], new Date('2026-10-01T00:00:00Z')));
  assert.ok(result.includes('DTSTART;VALUE=DATE:20261020\r\nDURATION:P6D'));
  assert.ok(result.includes('TRIGGER;VALUE=DATE-TIME:20261013T010000Z'));
  assert.ok(result.includes('TRIGGER;VALUE=DATE-TIME:20261025T010000Z'));
  assert.ok(result.includes('DTSTAMP:20261001T000000Z'));
  assert.ok(result.includes('约 ¥300.00'));
});
test('calendar excludes paid/cancelled/unknown dates and merges duplicate same-day alarms', () => {
  const result = wardrobeCalendar([order({ startDate: '2026-10-20', endDate: '2026-10-20', remindDays: 0 }), paid({ id: 'paid' }), order({ id: 'unknown', startDate: '', endDate: '' }), order({ id: 'cancelled', status: 'cancelled' })]);
  assert.equal((result.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((result.match(/BEGIN:VALARM/g) || []).length, 1);
  assert.ok(result.includes('DURATION:P1D'));
  assert.throws(() => wardrobeCalendar([paid()]), /还没有设置/);
});
test('calendar escapes injected content and folds Unicode lines to 75 octets', () => {
  const title = '漂亮的小裙子'.repeat(8) + '\nBEGIN:VEVENT,;\\';
  const result = wardrobeCalendar([order({ title })]);
  for (const line of result.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal((result.match(/^BEGIN:VEVENT$/gm) || []).length, 1);
  const flat = unfolded(result);
  assert.ok(flat.includes('\\nBEGIN:VEVENT\\,\\;\\\\'));
  assert.ok(flat.includes('UID:lolita-dress-1@ran-jin.local'));
});
