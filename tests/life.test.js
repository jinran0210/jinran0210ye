import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, MAX_EVENTS, emptyArchive, validateArchive, validateEvent, validPhoto, filteredEvents, mergeArchives, nextAnniversary, anniversaries, daysBetween, relativeDate } from '../src/life/model.js';
import { readArchive, updateArchive, replaceArchive } from '../src/life/storage.js';

const item = (changes = {}) => ({ id: 'moment-1', title: '重要的一天', date: '2024-06-20', category: 'learning', place: '校园', story: '完成一个重要目标。', starred: true, annual: false, photo: '', createdAt: 1, updatedAt: 1, ...changes });
const archive = events => ({ ...emptyArchive(), events });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9Z8AAAAASUVORK5CYII=';

test('valid records preserve photo and story while trimming the title', () => {
  const result = validateEvent(item({ title: '  重要的一天  ', photo: png }));
  assert.equal(result.title, '重要的一天'); assert.equal(result.photo, png); assert.equal(result.story, '完成一个重要目标。');
});
test('invalid dates, categories and field lengths are rejected', () => {
  for (const bad of [{ title: ' ' }, { title: '字'.repeat(61) }, { date: '2026-02-29' }, { category: '__proto__' }, { story: '字'.repeat(4001) }, { place: '字'.repeat(81) }, { starred: 'true' }, { updatedAt: 0 }]) assert.throws(() => validateEvent(item(bad)));
});
test('photos accept supported local formats and reject remote URLs or SVG payloads', () => {
  assert.equal(validPhoto(png), true);
  assert.equal(validPhoto(''), true);
  for (const photo of ['https://example.com/private-photo.jpg', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4=', 'data:image/jpeg;base64,not-a-photo']) assert.equal(validPhoto(photo), false, photo);
});
test('a ledger backup cannot be imported as life records', () => {
  assert.throws(() => validateArchive({ version: 1, transactions: [], budgets: {} }));
  assert.throws(() => validateArchive({ ...emptyArchive(), version: 2 }));
});
test('duplicate records and excessive archive counts are rejected atomically', () => {
  assert.throws(() => validateArchive(archive([item(), item()])));
  assert.throws(() => validateArchive(archive(Array.from({ length: MAX_EVENTS + 1 }, (_, index) => item({ id: `id-${index}` })))));
});
test('filters combine title/story/location search, year, category and important markers', () => {
  const events = [item(), item({ id: 'trip', title: '旅行', date: '2025-08-01', category: 'travel', place: '海边', story: '看海', starred: false })];
  assert.deepEqual(filteredEvents(events, { category: 'travel', year: '2025', search: '海边' }).map(event => event.id), ['trip']);
  assert.deepEqual(filteredEvents(events, { starred: true }).map(event => event.id), ['moment-1']);
  assert.equal(filteredEvents(events, { search: '看海' }).length, 1);
  assert.equal(filteredEvents(events, { search: '<script>' }).length, 0);
});
test('the timeline can be read in either chronological direction', () => {
  const events = [item(), item({ id: 'later', date: '2026-09-01' }), item({ id: 'earlier', date: '2020-01-01' })];
  assert.deepEqual(filteredEvents(events).map(event => event.id), ['later', 'moment-1', 'earlier']);
  assert.deepEqual(filteredEvents(events, { sort: 'oldest' }).map(event => event.id), ['earlier', 'moment-1', 'later']);
});
test('calendar-day differences are not affected by daylight saving transitions', () => {
  assert.equal(daysBetween('2024-03-09', '2024-03-11'), 2);
  assert.equal(relativeDate('2026-10-14', '2026-10-14'), '就是今天');
  assert.equal(relativeDate('2026-10-15', '2026-10-14'), '还有 1 天');
});
test('anniversaries handle today and crossing into the next year', () => {
  assert.deepEqual(nextAnniversary(item({ date: '2020-10-14', annual: true }), '2026-10-14'), { date: '2026-10-14', days: 0 });
  assert.deepEqual(nextAnniversary(item({ date: '2020-01-01', annual: true }), '2026-12-31'), { date: '2027-01-01', days: 1 });
  assert.equal(nextAnniversary(item(), '2026-10-14'), null);
});
test('February 29 anniversaries use February 28 in non-leap years', () => {
  assert.deepEqual(nextAnniversary(item({ date: '2024-02-29', annual: true }), '2025-02-01'), { date: '2025-02-28', days: 27 });
  assert.equal(nextAnniversary(item({ date: '2024-02-29', annual: true }), '2028-02-01').date, '2028-02-29');
});
test('future moments are not treated as already completed anniversaries', () => {
  assert.equal(nextAnniversary(item({ date: '2027-03-01', annual: true }), '2026-03-01').date, '2027-03-01');
  assert.equal(nextAnniversary(item({ date: '2020-01-01', annual: true }), '9999-12-31'), null);
});
test('nearest anniversaries are ordered by actual remaining days', () => {
  const events = [item({ id: 'late', date: '2020-12-01', annual: true }), item({ id: 'near', date: '2021-10-15', annual: true })];
  assert.deepEqual(anniversaries(events, '2026-10-14').map(value => value.event.id), ['near', 'late']);
});
test('merging backups preserves newer local stories and photos and is repeatable', () => {
  const existing = archive([item({ title: '本地已编辑', photo: png, updatedAt: 2 })]);
  const backup = archive([item(), item({ id: 'new' })]);
  const merged = mergeArchives(existing, backup);
  assert.equal(merged.events.length, 2); assert.equal(merged.events[0].photo, png); assert.equal(merged.events[0].title, '本地已编辑');
  assert.deepEqual(mergeArchives(merged, backup), merged);
});
test('failed storage writes preserve the previously saved stories', () => {
  const raw = JSON.stringify(archive([item()]));
  const storage = { getItem: () => raw, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
  assert.throws(() => updateArchive(storage, () => emptyArchive()), { name: 'QuotaExceededError' });
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});
test('invalid existing data is not overwritten before confirmed recovery', () => {
  let raw = '{broken';
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  assert.throws(() => updateArchive(storage, () => emptyArchive())); assert.equal(raw, '{broken');
  replaceArchive(storage, archive([item()])); assert.equal(readArchive(storage).events.length, 1);
});
test('life records have their own storage key and cannot alter bookkeeping data', () => {
  const values = new Map([['ran-jin-ledger:v1', 'existing ledger data']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  updateArchive(storage, current => ({ ...current, events: [item()] }));
  assert.equal(values.get('ran-jin-ledger:v1'), 'existing ledger data');
  assert.equal(readArchive(storage).events.length, 1);
});
