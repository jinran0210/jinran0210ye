import { validateOrder, balanceLabel, rangeLabel, daysBetween, shiftDate, formatMoney } from './model.js';

function escape(value) { return String(value).replaceAll('\\', '\\\\').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,'); }
function fold(value) {
  const encoder = new TextEncoder(); let lines = ''; let length = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (length + size > 75) { lines += '\r\n '; length = 1; }
    lines += char; length += size;
  }
  return lines;
}
const compact = value => value.replaceAll('-', '');
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function wardrobeCalendar(orders, now = new Date()) {
  const scheduled = orders.map(validateOrder).filter(order => order.status === 'pending' && order.startDate);
  if (!scheduled.length) throw new Error('还没有设置补款日期的待补订单。先为裙子填写预计补款时间吧。');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ran Jin//Lolita Wardrobe//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:裙期 · 尾款提醒', 'X-WR-TIMEZONE:Asia/Shanghai'];
  for (const order of scheduled) {
    const description = `尾款：${balanceLabel(order)}\n已付定金：${formatMoney(order.deposit)}\n预计补款：${rangeLabel(order)}\n店铺：${order.shop || '未填写'}\n时间与金额请以店铺最终公告为准。日历为导出时的快照，修改订单后请重新导出并清理旧提醒。`;
    lines.push('BEGIN:VEVENT', `UID:lolita-${order.id}@ran-jin.local`, `DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(new Date(order.updatedAt))}`, `DTSTART;VALUE=DATE:${compact(order.startDate)}`, `DURATION:P${daysBetween(order.startDate, order.endDate) + 1}D`, `SUMMARY:${escape(`尾款｜${order.title}｜${balanceLabel(order)}`)}`, `DESCRIPTION:${escape(description)}`, 'TRANSP:TRANSPARENT');
    const dates = new Set([shiftDate(order.startDate, -order.remindDays), order.endDate].filter(Boolean));
    for (const date of dates) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER;VALUE=DATE-TIME:${compact(date)}T010000Z`, `DESCRIPTION:${escape(`${order.title}：预计尾款 ${balanceLabel(order)}，请确认店铺公告。`)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
