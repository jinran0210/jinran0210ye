export const STORAGE_KEY = 'ran-jin-ledger:v1';
export const MAX_CENTS = 999_999_999;
export const MAX_RECORDS = 10_000;
export const categories = {
  expense: [
    { id: 'food', name: '餐饮美食', icon: '餐', color: '#c88154' },
    { id: 'transport', name: '交通出行', icon: '行', color: '#779ba1' },
    { id: 'shopping', name: '日常购物', icon: '购', color: '#a98bc1' },
    { id: 'housing', name: '居家生活', icon: '家', color: '#6b9176' },
    { id: 'learning', name: '学习成长', icon: '学', color: '#c4a357' },
    { id: 'leisure', name: '休闲娱乐', icon: '乐', color: '#c68197' },
    { id: 'health', name: '医疗健康', icon: '医', color: '#719a91' },
    { id: 'other-expense', name: '其他支出', icon: '其', color: '#949a90' },
  ],
  income: [
    { id: 'salary', name: '工资收入', icon: '薪', color: '#517b62' },
    { id: 'allowance', name: '补贴奖金', icon: '奖', color: '#69947a' },
    { id: 'side-income', name: '其他收入', icon: '收', color: '#7c9a66' },
  ],
};
export const accounts = { wechat: '微信', alipay: '支付宝', card: '银行卡', cash: '现金', other: '其他' };
export const categoryById = Object.fromEntries(Object.values(categories).flat().map(item => [item.id, item]));
const moneyFormatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });

export function formatMoney(cents) { return moneyFormatter.format(cents / 100); }
export function emptyLedger() { return { version: 1, transactions: [], budgets: {} }; }
export function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function currentMonth() { return today().slice(0, 7); }

export function parseMoney(value) {
  const text = String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw new Error('请输入有效金额，最多保留两位小数。');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0 || cents > MAX_CENTS) throw new Error('金额需大于 0，且不超过 9,999,999.99 元。');
  return cents;
}

export function validMonth(value) {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  const total = year * 12 + number - 1 + offset;
  const nextYear = Math.floor(total / 12);
  if (nextYear < 1 || nextYear > 9999) return month;
  return `${String(nextYear).padStart(4, '0')}-${String(total % 12 + 1).padStart(2, '0')}`;
}

export function validateTransaction(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('备份中存在无效记录。');
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id)) throw new Error('记录编号无效。');
  if (!Object.hasOwn(categories, record.type)) throw new Error('收支类型无效。');
  if (!Number.isSafeInteger(record.amount) || record.amount <= 0 || record.amount > MAX_CENTS) throw new Error('记录金额必须是有效的整数分值。');
  if (!categories[record.type].some(item => item.id === record.category)) throw new Error('记录分类与收支类型不匹配。');
  if (!validDate(record.date)) throw new Error('记录日期无效。');
  if (!Object.hasOwn(accounts, record.account)) throw new Error('记录账户无效。');
  if (typeof record.note !== 'string' || record.note.length > 120) throw new Error('备注需为文字，且不超过 120 个字符。');
  if (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0) throw new Error('记录创建时间无效。');
  return { id: record.id, type: record.type, amount: record.amount, category: record.category, date: record.date, account: record.account, note: record.note, createdAt: record.createdAt };
}

export function validateLedger(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.transactions) || !value.budgets || typeof value.budgets !== 'object' || Array.isArray(value.budgets)) throw new Error('不是受支持的轻记账 JSON 备份。');
  if (value.transactions.length > MAX_RECORDS) throw new Error('记录超过 10,000 条，请拆分账本后再导入。');
  const transactions = value.transactions.map(validateTransaction);
  if (new Set(transactions.map(item => item.id)).size !== transactions.length) throw new Error('备份中存在重复记录编号。');
  const budgets = {};
  const entries = Object.entries(value.budgets);
  if (entries.length > 1200) throw new Error('预算月份过多。');
  for (const [month, amount] of entries) {
    if (!validMonth(month) || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CENTS) throw new Error('备份中存在无效的月度预算。');
    budgets[month] = amount;
  }
  return { version: 1, transactions, budgets };
}

export function mergeLedgers(existing, imported) {
  const ids = new Set(existing.transactions.map(item => item.id));
  return validateLedger({ version: 1, transactions: [...existing.transactions, ...imported.transactions.filter(item => !ids.has(item.id))], budgets: { ...imported.budgets, ...existing.budgets } });
}

export function monthlySummary(transactions, month) {
  const selected = transactions.filter(item => item.date.startsWith(`${month}-`));
  const income = selected.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = selected.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, balance: income - expense, count: selected.length };
}
export function expenseCategories(transactions, month) {
  const totals = new Map();
  transactions.filter(item => item.type === 'expense' && item.date.startsWith(`${month}-`)).forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + item.amount));
  return [...totals].map(([id, amount]) => ({ ...categoryById[id], amount })).sort((a, b) => b.amount - a.amount);
}
export function filteredTransactions(transactions, { month, type = 'all', category = 'all', search = '', sort = 'newest' }) {
  const query = search.trim().toLocaleLowerCase();
  return transactions.filter(item => item.date.startsWith(`${month}-`) && (type === 'all' || item.type === type) && (category === 'all' || item.category === category) && (!query || [item.note, categoryById[item.category].name, accounts[item.account], item.date].some(value => value.toLocaleLowerCase().includes(query)))).sort((a, b) => {
    if (sort === 'largest') return b.amount - a.amount || b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    if (sort === 'smallest') return a.amount - b.amount || b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    const order = a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    return sort === 'oldest' ? order : -order;
  });
}

function csvCell(value) {
  let text = String(value);
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function transactionsCsv(transactions) {
  const rows = [['日期', '类型', '分类', '金额（元）', '账户', '备注'], ...transactions.map(item => [item.date, item.type === 'income' ? '收入' : '支出', categoryById[item.category].name, (item.amount / 100).toFixed(2), accounts[item.account], item.note])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function demoLedger(month = currentMonth()) {
  const entries = [
    ['income', 850000, 'salary', 1, 'card', '本月工资'],
    ['expense', 180000, 'housing', 2, 'card', '房租'],
    ['expense', 4320, 'food', 5, 'wechat', '和朋友吃午饭'],
    ['expense', 1800, 'transport', 6, 'alipay', '地铁通勤'],
    ['expense', 16900, 'shopping', 8, 'alipay', '生活用品'],
    ['expense', 8200, 'learning', 10, 'wechat', '一本想读很久的书'],
    ['expense', 3500, 'leisure', 12, 'wechat', '周末电影'],
    ['income', 30000, 'allowance', 13, 'card', '项目补贴'],
    ['expense', 3120, 'health', 14, 'wechat', '日常药品'],
  ];
  return { version: 1, transactions: entries.map(([type, amount, category, day, account, note], index) => ({ id: `demo-${index}`, type, amount, category, date: `${month}-${String(day).padStart(2, '0')}`, account, note, createdAt: index })), budgets: { [month]: 350000 } };
}
