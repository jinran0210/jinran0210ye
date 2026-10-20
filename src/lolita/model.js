import { validDate, today, parseMoney, formatMoney, MAX_CENTS } from '../ledger/model.js';
import { validPhoto, MAX_PHOTO_CHARS } from '../life/model.js';

export { today, formatMoney, MAX_PHOTO_CHARS };
export const MAX_ORDERS = 500;
export const MAX_ARCHIVE_CHARS = 25_000_000;
export const reminderDays = [0, 1, 3, 7, 14, 30];
export const statuses = { pending: '待补尾款', paid: '已付尾款', cancelled: '已取消' };
export const stages = { overdue: '已过预计时间', open: '正在补款', upcoming: '即将补款', waiting: '等待补款', unscheduled: '时间待确认', paid: '已付尾款', cancelled: '已取消' };
export function emptyWardrobe() { return { format: 'lolita-wardrobe', version: 1, orders: [] }; }
export function moneyInput(value, { optional = false } = {}) {
  const text = String(value).trim();
  if (!text && optional) return null;
  if (/^0(?:\.0{1,2})?$/.test(text)) return 0;
  return parseMoney(text);
}
function textField(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}${required ? '必填，且' : ''}最多 ${max} 字。`);
  return value.trim();
}
const validAmount = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
export function validateOrder(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('订单格式无效。');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('订单编号无效。');
  const title = textField(value.title, '裙子名称', 80, true);
  const shop = textField(value.shop, '店铺名称', 80);
  const orderNumber = textField(value.orderNumber, '订单号', 100);
  const variant = textField(value.variant, '颜色与尺码', 100);
  const note = textField(value.note, '备注', 2000);
  if (!validAmount(value.deposit) || (value.balance !== null && !validAmount(value.balance))) throw new Error('请输入有效的定金和尾款金额，最多两位小数。');
  if (!validDate(value.depositDate)) throw new Error('请选择有效的定金支付日期。');
  if (typeof value.balanceEstimated !== 'boolean') throw new Error('尾款预估标记无效。');
  if (!(value.startDate === '' && value.endDate === '') && (!validDate(value.startDate) || !validDate(value.endDate) || value.startDate > value.endDate)) throw new Error('补款时间范围无效，结束日期不能早于开始日期。');
  if (!reminderDays.includes(value.remindDays)) throw new Error('请选择有效的提前提醒天数。');
  if (!Object.hasOwn(statuses, value.status)) throw new Error('订单状态无效。');
  if (value.status === 'paid' ? !validDate(value.paidDate) || !validAmount(value.paidAmount) : value.paidDate !== '' || value.paidAmount !== null) throw new Error('已付尾款订单需要填写实际付款金额和日期。');
  if (!Array.isArray(value.photos) || value.photos.length > 6) throw new Error('每笔订单最多 3 张裙图和 3 张定金凭证。');
  const photos = value.photos.map(photo => {
    if (!photo || typeof photo.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(photo.id) || !['dress', 'receipt'].includes(photo.kind) || !photo.data || !validPhoto(photo.data)) throw new Error('图片格式无效，仅支持本地 JPG、PNG、WebP 图片。');
    return { id: photo.id, kind: photo.kind, data: photo.data };
  });
  if (new Set(photos.map(photo => photo.id)).size !== photos.length || ['dress', 'receipt'].some(kind => photos.filter(photo => photo.kind === kind).length > 3)) throw new Error('图片编号重复或同类图片超过 3 张。');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt || value.updatedAt > 253402300799999) throw new Error('订单创建或修改时间无效。');
  return { id: value.id, title, shop, orderNumber, variant, note, deposit: value.deposit, depositDate: value.depositDate, balance: value.balance, balanceEstimated: value.balanceEstimated, startDate: value.startDate, endDate: value.endDate, remindDays: value.remindDays, status: value.status, paidDate: value.paidDate, paidAmount: value.paidAmount, photos, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
export function validateWardrobe(value) {
  if (!value || value.format !== 'lolita-wardrobe' || value.version !== 1 || !Array.isArray(value.orders)) throw new Error('请选择裙期导出的 JSON 备份。');
  if (value.orders.length > MAX_ORDERS) throw new Error('每份手账最多 500 笔订单，请先导出归档。');
  const orders = value.orders.map(validateOrder);
  if (new Set(orders.map(order => order.id)).size !== orders.length) throw new Error('备份中存在重复订单编号。');
  const result = { ...emptyWardrobe(), orders };
  if (JSON.stringify(result).length > MAX_ARCHIVE_CHARS) throw new Error('手账图片较多，请导出归档后减少部分图片。此次更改未保存。');
  return result;
}
export function mergeWardrobes(existing, incoming) {
  const ids = new Set(existing.orders.map(order => order.id));
  return validateWardrobe({ ...emptyWardrobe(), orders: [...existing.orders, ...incoming.orders.filter(order => !ids.has(order.id))] });
}
export function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000); }
export function shiftDate(value, offset) {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
  const result = date.toISOString().slice(0, 10);
  return validDate(result) ? result : null;
}
export function stageOf(order, reference = today()) {
  if (order.status !== 'pending') return order.status;
  if (!order.startDate) return 'unscheduled';
  if (reference > order.endDate) return 'overdue';
  if (reference >= order.startDate) return 'open';
  return daysBetween(reference, order.startDate) <= order.remindDays ? 'upcoming' : 'waiting';
}
export function timingLabel(order, reference = today()) {
  const stage = stageOf(order, reference);
  if (stage === 'paid') return `${dateLabel(order.paidDate)} 已补尾款`;
  if (stage === 'cancelled') return '此订单已取消，不再提醒';
  if (stage === 'unscheduled') return '等店铺公告后，随时补充时间';
  if (stage === 'overdue') return `已超过预计结束日 ${daysBetween(order.endDate, reference)} 天，请向店铺确认`;
  if (stage === 'open') return order.endDate === reference ? '预计今天结束，请确认店铺公告' : `预计还有 ${daysBetween(reference, order.endDate)} 天结束`;
  return `距离预计开始还有 ${daysBetween(reference, order.startDate)} 天`;
}
export function dateLabel(value) { return value ? value.replaceAll('-', '.') : '时间待确认'; }
export function rangeLabel(order) { return !order.startDate ? '补款时间待确认' : order.startDate === order.endDate ? dateLabel(order.startDate) : `${dateLabel(order.startDate)} — ${dateLabel(order.endDate)}`; }
export function balanceLabel(order) { return order.balance === null ? '待确认' : `${order.balanceEstimated ? '约 ' : ''}${formatMoney(order.balance)}`; }
export function overlaps(order, start, end) { return Boolean(order.startDate && order.startDate <= end && order.endDate >= start); }
export function summary(orders, reference = today()) {
  const pending = orders.filter(order => order.status === 'pending');
  const open = pending.filter(order => stageOf(order, reference) === 'open');
  const horizon = shiftDate(reference, 30) || '9999-12-31';
  const soon = pending.filter(order => overlaps(order, reference, horizon));
  const total = list => ({ amount: list.reduce((sum, order) => sum + (order.balance ?? 0), 0), unknown: list.filter(order => order.balance === null).length, count: list.length });
  return { pending: total(pending), open: total(open), soon: total(soon), deposit: orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + order.deposit, 0), unscheduled: pending.filter(order => !order.startDate).length };
}
export function purchasedSummary(orders) {
  const purchased = orders.filter(order => order.status === 'paid');
  const deposit = purchased.reduce((sum, order) => sum + order.deposit, 0);
  const balance = purchased.reduce((sum, order) => sum + order.paidAmount, 0);
  return { count: purchased.length, deposit, balance, total: deposit + balance };
}
const priority = { overdue: 0, open: 1, upcoming: 2, waiting: 3, unscheduled: 4, paid: 5, cancelled: 6 };
export function filteredOrders(orders, { stage = 'all', search = '', month = '', sort = 'due', view = 'all' } = {}, reference = today()) {
  const query = search.trim().toLocaleLowerCase();
  const monthStart = month ? `${month}-01` : '';
  const monthEnd = month ? `${month}-31` : '';
  return orders.filter(order => (view !== 'purchased' || order.status === 'paid') && (view !== 'pending' || order.status === (stage === 'cancelled' ? 'cancelled' : 'pending')) && (stage === 'all' || (stage === 'pending' ? order.status === 'pending' : stageOf(order, reference) === stage)) && (!query || [order.title, order.shop, order.variant, order.orderNumber, order.note].some(value => value.toLocaleLowerCase().includes(query))) && (!month || (view === 'purchased' ? order.paidDate.startsWith(`${month}-`) : overlaps(order, monthStart, monthEnd)))).sort((a, b) => {
    if (view === 'purchased' && sort === 'due') return b.paidDate.localeCompare(a.paidDate) || b.updatedAt - a.updatedAt;
    if (sort === 'newest') return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
    if (sort === 'amount') return (view === 'purchased' ? b.deposit + b.paidAmount - a.deposit - a.paidAmount : (b.balance ?? -1) - (a.balance ?? -1)) || a.id.localeCompare(b.id);
    return priority[stageOf(a, reference)] - priority[stageOf(b, reference)] || (a.endDate || '9999-12-31').localeCompare(b.endDate || '9999-12-31') || b.createdAt - a.createdAt;
  });
}
export function demoWardrobe(reference = today()) {
  const samples = [
    ['月光花园 · JSK', '示例店铺 A', 18000, 42800, -2, 5, true],
    ['草莓茶会 · OP', '示例店铺 B', 10000, 29900, 5, 12, true],
    ['星河来信 · SK', '示例店铺 C', 15000, null, null, null, true],
  ];
  return { ...emptyWardrobe(), orders: samples.map(([title, shop, deposit, balance, start, end, balanceEstimated], index) => ({ id: `demo-${index}`, title, shop, deposit, balance, balanceEstimated, depositDate: reference, startDate: start === null ? '' : shiftDate(reference, start) || reference, endDate: end === null ? '' : shiftDate(reference, end) || reference, remindDays: 7, status: 'pending', paidDate: '', paidAmount: null, orderNumber: '', variant: ['奶油白 / M', '莓果粉 / S', '藏青 / 均码'][index], note: '这是演示订单，不代表你的真实购买。', photos: [], createdAt: index, updatedAt: index })) };
}
