import { today, validDate } from '../ledger/model.js';

export { today };
export const STORAGE_KEY = 'ran-jin-life:v1';
export const MAX_EVENTS = 500;
export const MAX_PHOTO_CHARS = 320_000;
export const MAX_ARCHIVE_CHARS = 1_600_000;
export const categories = [
  { id: 'learning', name: '学习求知', icon: '学', color: '#657d55' },
  { id: 'career', name: '事业旅程', icon: '业', color: '#728d94' },
  { id: 'family', name: '亲密关系', icon: '爱', color: '#b68186' },
  { id: 'travel', name: '探索世界', icon: '行', color: '#c0915f' },
  { id: 'growth', name: '个人成长', icon: '成', color: '#9385a6' },
  { id: 'other', name: '其他时刻', icon: '记', color: '#798774' },
];
export const categoryById = Object.fromEntries(categories.map(item => [item.id, item]));
export function emptyArchive() { return { format: 'life-moments', version: 1, events: [] }; }

export function validPhoto(photo) {
  if (photo === '') return true;
  if (typeof photo !== 'string' || photo.length > MAX_PHOTO_CHARS) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match || match[2].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[2]);
    if (match[1] === 'jpeg') return bytes.startsWith('\xff\xd8\xff');
    if (match[1] === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}

export function validateEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记录格式无效。');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('记录编号无效。');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 60) throw new Error('请填写标题，最多 60 字。');
  if (!validDate(value.date)) throw new Error('请选择有效日期。');
  if (!Object.hasOwn(categoryById, value.category)) throw new Error('请选择有效分类。');
  if (typeof value.place !== 'string' || value.place.length > 80) throw new Error('地点最多 80 字。');
  if (typeof value.story !== 'string' || value.story.length > 4000) throw new Error('故事最多 4,000 字。');
  if (typeof value.starred !== 'boolean' || typeof value.annual !== 'boolean') throw new Error('记录标记无效。');
  if (!validPhoto(value.photo)) throw new Error('照片格式无效或过大，仅支持本地 JPEG、PNG、WebP 图片。');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) throw new Error('记录时间信息无效。');
  return { id: value.id, title: value.title.trim(), date: value.date, category: value.category, place: value.place, story: value.story, starred: value.starred, annual: value.annual, photo: value.photo, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function validateArchive(value) {
  if (!value || value.format !== 'life-moments' || value.version !== 1 || !Array.isArray(value.events)) throw new Error('不是受支持的人生记录 JSON 备份。');
  if (value.events.length > MAX_EVENTS) throw new Error('每个档案最多 500 条记录，请先导出归档。');
  const events = value.events.map(validateEvent);
  if (new Set(events.map(item => item.id)).size !== events.length) throw new Error('备份中存在重复的记录编号。');
  const archive = { format: 'life-moments', version: 1, events };
  if (JSON.stringify(archive).length > MAX_ARCHIVE_CHARS) throw new Error('本地档案较大，请备份后精简照片或内容。原数据尚未改变。');
  return archive;
}
export function mergeArchives(existing, incoming) {
  const ids = new Set(existing.events.map(item => item.id));
  return validateArchive({ ...emptyArchive(), events: [...existing.events, ...incoming.events.filter(item => !ids.has(item.id))] });
}
export function filteredEvents(events, { category = 'all', year = 'all', starred = false, search = '', sort = 'newest' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return events.filter(item => (category === 'all' || item.category === category) && (year === 'all' || item.date.startsWith(`${year}-`)) && (!starred || item.starred) && (!query || [item.title, item.story, item.place, categoryById[item.category].name].some(text => text.toLocaleLowerCase().includes(query)))).sort((a, b) => {
    const order = a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    return sort === 'oldest' ? order : -order;
  });
}
export function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000); }
export function nextAnniversary(event, reference = today()) {
  if (!event.annual) return null;
  if (event.date >= reference) return { date: event.date, days: daysBetween(reference, event.date) };
  const dateInYear = year => {
    const value = `${String(year).padStart(4, '0')}${event.date.slice(4)}`;
    return validDate(value) ? value : `${String(year).padStart(4, '0')}-02-28`;
  };
  const year = Number(reference.slice(0, 4));
  let next = dateInYear(year);
  if (next < reference) {
    if (year === 9999) return null;
    next = dateInYear(year + 1);
  }
  return { date: next, days: daysBetween(reference, next) };
}
export function anniversaries(events, reference = today()) {
  return events.map(event => ({ event, next: nextAnniversary(event, reference) })).filter(item => item.next).sort((a, b) => a.next.days - b.next.days || a.event.date.localeCompare(b.event.date));
}
export function dateLabel(value) { return `${value.slice(0, 4)}.${value.slice(5, 7)}.${value.slice(8, 10)}`; }
export function relativeDate(value, reference = today()) {
  const days = daysBetween(value, reference);
  if (days === 0) return '就是今天';
  return days > 0 ? `${days.toLocaleString('zh-CN')} 天前` : `还有 ${Math.abs(days).toLocaleString('zh-CN')} 天`;
}
export function demoArchive(reference = today()) {
  const year = Number(reference.slice(0, 4));
  const items = [
    ['新的起点，新的世界', `${year}-09-01`, 'learning', '校园', '走进一个新的学习阶段。带着好奇与期待，开始探索更大的世界。\n愿每一次提问，都能打开一扇新的门。', true, true],
    ['把一个想法变成现实', `${year}-06-15`, 'growth', '自己的小天地', '从一张草稿到一个可以使用的小作品，经历了许多次尝试。原来，完成一件事情的快乐，藏在每一个小小的进步里。', true, false],
    ['第一次独自出发', `${Math.max(1, year - 1)}-08-20`, 'travel', '一座想去很久的城市', '背上行囊，独自走进陌生的街道。遇见新的风景，也更认识自己。', false, false],
    ['和重要的人一起庆祝', `${Math.max(1, year - 2)}-12-01`, 'family', '家', '一次温暖的相聚，一张珍贵的合影。生活里的幸福，有时就是大家坐在一起，好好吃一顿饭。', true, true],
  ];
  return { ...emptyArchive(), events: items.map(([title, date, category, place, story, starred, annual], index) => ({ id: `demo-${index}`, title, date, category, place, story, starred, annual, photo: '', createdAt: index, updatedAt: index })) };
}
