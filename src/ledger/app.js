import './style.css';
import { STORAGE_KEY, MAX_RECORDS, categories, accounts, categoryById, emptyLedger, formatMoney, parseMoney, today, currentMonth, validMonth, validateTransaction, validateLedger, shiftMonth, monthlySummary, expenseCategories, filteredTransactions, mergeLedgers, transactionsCsv, demoLedger } from './model.js';
import { readLedger, updateLedger, replaceLedger } from './storage.js';
import { SECRET_STORAGE_KEY, validateSecretBackup, decryptSecretBackup, openSecretLedger } from './secret.js';

const $ = selector => document.querySelector(selector);
let ledger = emptyLedger();
let storageProblem = '';
let month = currentMonth();
let realMonth = month;
let demo = null;
let page = 1;
const PAGE_SIZE = 20;
let entryType = 'expense';
let entryCategory = categories.expense[0].id;
let editingRecord = null;
let deletingRecord = null;
let budgetMonth;
let originalBudget;
let pendingImport;
let lastDeleted;
let toastTimer;
let secretSession = null;
let secretAttempt = null;
let secretBackup = null;
let secretHasStored = false;
let secretOriginal = null;
let normalMonth;
let idleTimer;
let saving = false;

function loadRealLedger() {
  try { ledger = readLedger(window.localStorage); storageProblem = ''; }
  catch { ledger = emptyLedger(); storageProblem = '无法读取本地账本。原始数据不会被覆盖；请先保存原始数据，再导入有效的 JSON 备份。浏览器禁止存储时，请检查浏览器设置。'; }
}
loadRealLedger();
function activeLedger() { return demo || ledger; }
function filters() { return { month, type: $('#type-filter').value, category: $('#category-filter').value, search: $('#search-input').value, sort: $('#sort-filter').value }; }
function getResults() { return filteredTransactions(activeLedger().transactions, filters()); }
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function monthLabel(value) { const [year, number] = value.split('-'); return `${year} 年 ${Number(number)} 月`; }
function showError(selector, error) { $(selector).textContent = error.message || String(error); $(selector).hidden = false; }
function clearError(selector) { $(selector).textContent = ''; $(selector).hidden = true; }

async function persist(transform) {
  if (demo) throw new Error('示例账本不保存更改，请先退出示例。');
  if (saving) throw new Error('正在保存，请稍候。');
  if (storageProblem) throw new Error('本地数据暂时无法读取，请先保存原始数据并恢复有效备份。');
  const session = secretSession;
  saving = true; render();
  try {
    const next = session ? await session.update(transform) : updateLedger(window.localStorage, transform);
    if (session !== secretSession) throw new Error('空间已锁定，请重新进入。');
    ledger = next;
  } catch (error) {
    if (['QuotaExceededError', 'SecurityError'].includes(error.name)) throw new Error('保存失败，更改尚未保存。请允许浏览器本地存储、释放空间，并备份现有数据。');
    throw error;
  } finally { saving = false; render(); }
}
function showToast(message, undo = false) {
  $('#toast-message').textContent = message;
  $('#undo-delete').hidden = !undo;
  if (!undo) lastDeleted = null;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), undo ? 12000 : 6000);
}

function updateCategoryFilter() {
  const selected = $('#category-filter').value;
  const type = $('#type-filter').value;
  const choices = type === 'all' ? Object.values(categories).flat() : categories[type];
  $('#category-filter').replaceChildren(new Option('全部分类', 'all'), ...choices.map(item => new Option(item.name, item.id)));
  if (choices.some(item => item.id === selected)) $('#category-filter').value = selected;
}
function resetFilters() {
  $('#type-filter').value = 'all'; $('#search-input').value = ''; $('#sort-filter').value = 'newest';
  updateCategoryFilter(); $('#category-filter').value = 'all'; page = 1;
}

function render() {
  const state = activeLedger();
  const summary = monthlySummary(state.transactions, month);
  $('#selected-month').value = month;
  $('#total-income').textContent = formatMoney(summary.income);
  $('#total-expense').textContent = formatMoney(summary.expense);
  $('#total-balance').textContent = formatMoney(summary.balance);
  const records = state.transactions.filter(item => item.date.startsWith(`${month}-`));
  $('#income-count').textContent = `${records.filter(item => item.type === 'income').length} 笔收入`;
  $('#expense-count').textContent = `${records.filter(item => item.type === 'expense').length} 笔支出`;
  const budget = state.budgets[month];
  const ratio = budget ? summary.expense / budget * 100 : 0;
  $('#budget-value').textContent = budget ? formatMoney(budget) : '未设置';
  $('#budget-fill').style.width = `${Math.min(ratio, 100)}%`;
  $('.budget-card').classList.toggle('over-budget', Boolean(budget && summary.expense > budget));
  $('.budget-track').setAttribute('aria-valuenow', String(Math.min(Math.round(ratio), 100)));
  $('.budget-track').setAttribute('aria-valuetext', budget ? `已使用 ${ratio.toFixed(1)}%，${summary.expense > budget ? '超出' : '剩余'} ${formatMoney(Math.abs(budget - summary.expense))}` : '尚未设置预算');
  $('#budget-note').textContent = budget ? summary.expense > budget ? `已超预算 ${formatMoney(summary.expense - budget)}` : `剩余 ${formatMoney(budget - summary.expense)} · 已用 ${ratio.toFixed(1)}%` : '给本月的支出定个小目标';
  $('#budget-button').textContent = budget ? '修改 ↗' : '设置 ↗';
  $('#storage-warning').hidden = !storageProblem;
  $('#storage-warning-text').textContent = storageProblem;
  $('#demo-notice').hidden = !demo;
  $('#demo-button').textContent = demo ? '退出示例 ↗' : '体验示例 ↗';
  $('#save-state').textContent = saving ? '正在保存…' : demo ? '示例，不保存' : storageProblem ? '存储不可用' : secretSession ? '本地加密保存' : '本地保存';
  $('#add-button').disabled = Boolean(demo || storageProblem || saving);
  $('#budget-button').disabled = Boolean(demo || storageProblem || saving);
  $('#import-trigger').disabled = Boolean(demo || saving);
  $('#import-file').disabled = Boolean(demo || saving);
  $('#export-json').textContent = demo ? '导出示例 JSON' : secretSession ? '导出秘密基地加密备份' : '导出 JSON 备份';
  $('#export-csv').hidden = Boolean(secretSession);
  $('#demo-button').hidden = Boolean(secretSession);
  $('#secret-notice').hidden = !secretSession;
  document.body.classList.toggle('secret-mode', Boolean(secretSession));
  $('#secret-entry').setAttribute('aria-label', secretSession ? '锁定私人空间' : '打开私人空间');
  $('#space-caption').textContent = secretSession ? '我的秘密基地 · 独立账本' : '我的生活账本';
  $('#space-eyebrow').textContent = secretSession ? 'A QUIET PLACE OF YOUR OWN' : 'A LITTLE CLARITY, EVERY DAY';
  $('#space-title').textContent = secretSession ? '秘密基地' : '把生活，记清楚';
  $('.heading-note').textContent = secretSession ? '留一点只属于自己的空间。这里的每一笔，不计入总账。' : '收支有数，日子有底。';
  document.title = secretSession ? '秘密基地 — 轻记账' : '轻记账 — 把生活记清楚';
  $('#overview-title').textContent = secretSession ? '秘密基地月度总览' : '月度账本总览';
  $('#save-entry').disabled = $('#confirm-delete').disabled = $('#undo-delete').disabled = saving;
  $('#budget-form button[type="submit"]').disabled = $('#import-form button[type="submit"]').disabled = saving;
  renderCategories(summary);
  renderTrend();
  renderList();
}

function renderCategories(summary) {
  const totals = expenseCategories(activeLedger().transactions, month);
  $('#category-count').textContent = `${totals.length} 类`;
  $('#category-donut').classList.toggle('empty-donut', !totals.length);
  let start = 0;
  const segments = totals.map(item => {
    const end = start + item.amount / summary.expense * 100;
    const segment = `${item.color} ${start}% ${end}%`;
    start = end; return segment;
  });
  $('#category-donut').style.background = segments.length ? `conic-gradient(${segments.join(',')})` : '';
  $('#category-donut').setAttribute('aria-label', totals.length ? totals.map(item => `${item.name} ${formatMoney(item.amount)}`).join('，') : '暂无支出分类数据');
  $('#category-legend').replaceChildren();
  if (!totals.length) { $('#category-legend').append(node('p', 'chart-empty', '还没有支出记录。\n记下第一笔，让统计慢慢清晰。')); return; }
  totals.forEach(item => {
    const button = node('button', 'category-row');
    const dot = node('i'); dot.style.background = item.color;
    const label = node('span', 'category-label', item.name);
    const amount = node('strong', '', formatMoney(item.amount));
    const ratio = node('small', '', `${(item.amount / summary.expense * 100).toFixed(1)}%`);
    button.append(dot, label, amount, ratio);
    button.setAttribute('aria-label', `${item.name}，${formatMoney(item.amount)}，筛选明细`);
    button.addEventListener('click', () => { $('#type-filter').value = 'expense'; updateCategoryFilter(); $('#category-filter').value = item.id; $('#search-input').value = ''; page = 1; renderList(); $('#transactions').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#category-legend').append(button);
  });
}

function renderTrend() {
  const values = Array.from({ length: 6 }, (_, index) => {
    const value = shiftMonth(month, index - 5);
    return { month: value, ...monthlySummary(activeLedger().transactions, value) };
  });
  const max = Math.max(1, ...values.flatMap(item => [item.income, item.expense]));
  $('#trend-chart').replaceChildren();
  values.forEach(item => {
    const group = node('div', 'trend-group');
    const caption = `${monthLabel(item.month)}：收入 ${formatMoney(item.income)}，支出 ${formatMoney(item.expense)}`;
    group.setAttribute('role', 'img'); group.setAttribute('aria-label', caption); group.title = caption;
    const bars = node('div', 'trend-bars'); bars.setAttribute('aria-hidden', 'true');
    for (const type of ['income', 'expense']) {
      const bar = node('span', `trend-bar ${type}`);
      bar.style.height = item[type] ? `${Math.max(2, item[type] / max * 100)}%` : '0';
      bars.append(bar);
    }
    group.append(node('small', 'trend-amount', item.income || item.expense ? `${(Math.max(item.income, item.expense) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` : '—'), bars, node('span', 'trend-month', `${Number(item.month.slice(5))}月`));
    $('#trend-chart').append(group);
  });
  $('#trend-caption').textContent = `${monthLabel(values[0].month)} — ${monthLabel(month)} · 柱顶为当月较高金额（元）`;
}

function renderList() {
  const results = getResults();
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  page = Math.min(page, pageCount);
  $('#record-list').replaceChildren();
  results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(record => {
    const category = categoryById[record.category];
    const row = node('article', 'record-row'); row.dataset.id = record.id;
    const main = node('div', 'record-main');
    const icon = node('span', 'record-icon', category.icon); icon.style.setProperty('--category-color', category.color); icon.setAttribute('aria-hidden', 'true');
    const description = node('div', 'record-description');
    description.append(node('h3', '', record.note || category.name), node('p', '', `${record.type === 'expense' ? '支出' : '收入'} · ${category.name}`));
    main.append(icon, description);
    const date = node('time', 'record-date', record.date); date.dateTime = record.date;
    const account = node('span', 'record-account', accounts[record.account]);
    const amount = node('strong', `record-amount ${record.type}`, `${record.type === 'income' ? '+' : '−'}${formatMoney(record.amount)}`);
    const actions = node('div', 'record-actions');
    const edit = node('button', 'row-button', '编辑'); edit.setAttribute('aria-label', `编辑${record.note || category.name}，${record.date}`);
    const remove = node('button', 'row-button delete', '删除'); remove.setAttribute('aria-label', `删除${record.note || category.name}，${record.date}`);
    edit.disabled = remove.disabled = Boolean(demo || storageProblem || saving);
    edit.addEventListener('click', () => openEntry(record));
    remove.addEventListener('click', () => { deletingRecord = { ...record }; clearError('#delete-error'); $('#delete-description').textContent = `${record.date} · ${record.note || category.name} · ${formatMoney(record.amount)}`; $('#delete-dialog').showModal(); });
    actions.append(edit, remove);
    row.append(main, date, account, amount, actions); $('#record-list').append(row);
  });
  $('#record-count').textContent = results.length;
  const income = results.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const expense = results.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  $('#result-summary').textContent = `${monthLabel(month)} · ${results.length} 条筛选结果`;
  $('#list-total').textContent = results.length ? `筛选合计：收入 ${formatMoney(income)} / 支出 ${formatMoney(expense)}` : '暂无匹配记录';
  $('#empty-state').hidden = results.length > 0;
  const filtered = $('#type-filter').value !== 'all' || $('#category-filter').value !== 'all' || Boolean($('#search-input').value.trim());
  const hasMonthRecords = activeLedger().transactions.some(item => item.date.startsWith(`${month}-`));
  $('#empty-title').textContent = filtered ? '没有找到匹配记录' : hasMonthRecords ? '这里还没有记录' : '从第一笔小记录开始';
  $('#empty-description').textContent = filtered ? '试着换个关键词、分类，或重置筛选。' : '一杯咖啡、一次通勤，或一份收入。\n把它记下来，就是一个好开始。';
  $('#empty-add').hidden = Boolean(filtered || demo || storageProblem);
  $('#pagination').hidden = results.length <= PAGE_SIZE;
  $('#page-label').textContent = `${page} / ${pageCount}`;
  $('#previous-page').disabled = page === 1; $('#next-page').disabled = page === pageCount;
}

function renderEntryCategories() {
  $('#entry-categories').replaceChildren();
  categories[entryType].forEach(item => {
    const button = node('button', 'category-choice'); button.type = 'button'; button.dataset.category = item.id;
    button.classList.toggle('selected', item.id === entryCategory); button.setAttribute('aria-pressed', String(item.id === entryCategory));
    const icon = node('span', '', item.icon); icon.setAttribute('aria-hidden', 'true');
    button.append(icon, node('span', '', item.name));
    button.addEventListener('click', () => { entryCategory = item.id; renderEntryCategories(); $('#entry-categories').querySelector(`[data-category="${item.id}"]`).focus(); });
    $('#entry-categories').append(button);
  });
  document.querySelectorAll('[data-entry-type]').forEach(button => { const selected = button.dataset.entryType === entryType; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
}
function openEntry(record = null) {
  if (demo || storageProblem) return;
  editingRecord = record ? { ...record } : null;
  $('#entry-form').reset(); clearError('#entry-error');
  $('#entry-title').textContent = `${secretSession ? '秘密基地 · ' : ''}${record ? '编辑这笔记录' : '记一笔'}`;
  $('#save-entry').textContent = record ? '保存修改' : '保存记录';
  entryType = record?.type || 'expense'; entryCategory = record?.category || categories[entryType][0].id;
  $('#entry-amount').value = record ? (record.amount / 100).toFixed(2) : '';
  $('#entry-date').value = record?.date || (month === currentMonth() ? today() : `${month}-01`);
  $('#entry-note').value = record?.note || ''; $('#entry-account').value = record?.account || 'wechat';
  renderEntryCategories(); $('#entry-dialog').showModal(); $('#entry-amount').focus();
}

$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#entry-error');
  try {
    const record = validateTransaction({ id: editingRecord?.id || crypto.randomUUID(), type: entryType, amount: parseMoney($('#entry-amount').value), category: entryCategory, date: $('#entry-date').value, account: $('#entry-account').value, note: $('#entry-note').value.trim(), createdAt: editingRecord?.createdAt ?? Date.now() });
    await persist(state => {
      if (editingRecord) {
        const existing = state.transactions.find(item => item.id === editingRecord.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(editingRecord)) throw new Error('这条记录已在其他窗口更改，请关闭后重新打开编辑。');
        return { ...state, transactions: state.transactions.map(item => item.id === record.id ? record : item) };
      }
      if (state.transactions.length >= MAX_RECORDS) throw new Error('账本已达到 10,000 条，请先导出归档。');
      return { ...state, transactions: [...state.transactions, record] };
    });
    month = record.date.slice(0, 7); resetFilters(); render(); $('#entry-dialog').close();
    showToast(editingRecord ? '修改已保存。' : '这一笔，记好了。');
  } catch (error) { showError('#entry-error', error); }
});
document.querySelectorAll('[data-entry-type]').forEach(button => button.addEventListener('click', () => { entryType = button.dataset.entryType; entryCategory = categories[entryType][0].id; renderEntryCategories(); }));
$('#entry-account').replaceChildren(...Object.entries(accounts).map(([id, name]) => new Option(name, id)));
$('#add-button').addEventListener('click', () => openEntry()); $('#empty-add').addEventListener('click', () => openEntry());

$('#budget-button').addEventListener('click', () => {
  budgetMonth = month; originalBudget = ledger.budgets[month];
  $('#budget-month-label').textContent = `${monthLabel(month)}的支出预算`;
  $('#budget-input').value = originalBudget ? (originalBudget / 100).toFixed(2) : '';
  clearError('#budget-error'); $('#budget-dialog').showModal(); $('#budget-input').focus();
});
$('#budget-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#budget-error');
  try {
    const value = $('#budget-input').value.trim(); const amount = value ? parseMoney(value) : null;
    await persist(state => { if (state.budgets[budgetMonth] !== originalBudget) throw new Error('预算已在其他窗口更改，请关闭后重新设置。'); const budgets = { ...state.budgets }; if (amount === null) delete budgets[budgetMonth]; else budgets[budgetMonth] = amount; return { ...state, budgets }; });
    $('#budget-dialog').close(); showToast(amount === null ? '该月预算已移除。' : '月度预算已保存。');
  } catch (error) { showError('#budget-error', error); }
});

$('#confirm-delete').addEventListener('click', async () => {
  clearError('#delete-error');
  try {
    await persist(state => { const existing = state.transactions.find(item => item.id === deletingRecord.id); if (!existing || JSON.stringify(existing) !== JSON.stringify(deletingRecord)) throw new Error('记录已在其他窗口更改，请关闭后重新查看。'); return { ...state, transactions: state.transactions.filter(item => item.id !== deletingRecord.id) }; });
    lastDeleted = deletingRecord; $('#delete-dialog').close(); showToast('记录已删除。', true);
  } catch (error) { showError('#delete-error', error); }
});
$('#undo-delete').addEventListener('click', async () => {
  if (!lastDeleted) return;
  try { const record = lastDeleted; await persist(state => ({ ...state, transactions: state.transactions.some(item => item.id === record.id) ? state.transactions : [...state.transactions, record] })); showToast('记录已恢复。'); }
  catch (error) { showToast(error.message); }
});
$('#dismiss-toast').addEventListener('click', () => $('#toast').classList.remove('visible'));

function changeMonth(value) { if (!validMonth(value)) { $('#selected-month').value = month; return; } month = value; page = 1; render(); }
$('#selected-month').addEventListener('change', event => changeMonth(event.target.value));
$('#previous-month').addEventListener('click', () => changeMonth(shiftMonth(month, -1)));
$('#next-month').addEventListener('click', () => changeMonth(shiftMonth(month, 1)));
$('#current-month').addEventListener('click', () => changeMonth(currentMonth()));
$('#search-input').addEventListener('input', () => { page = 1; renderList(); });
$('#type-filter').addEventListener('change', () => { updateCategoryFilter(); page = 1; renderList(); });
['#category-filter', '#sort-filter'].forEach(selector => $(selector).addEventListener('change', () => { page = 1; renderList(); }));
$('#reset-filters').addEventListener('click', () => { resetFilters(); renderList(); });
$('#previous-page').addEventListener('click', () => { page--; renderList(); }); $('#next-page').addEventListener('click', () => { page++; renderList(); });

function toggleDemo() {
  if (demo) { demo = null; month = realMonth; }
  else { realMonth = month; month = currentMonth(); demo = demoLedger(month); }
  resetFilters(); render();
}
$('#demo-button').addEventListener('click', toggleDemo); $('#exit-demo').addEventListener('click', toggleDemo);

function download(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type })); const link = node('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); $('.data-menu').open = false;
}
$('#export-json').addEventListener('click', () => {
  if (secretSession) { exportSecretData(); return; }
  if (storageProblem && !demo) { showToast('请先使用“保存原始数据”，避免把空账本当作备份。'); return; }
  download(JSON.stringify({ ...activeLedger(), exportedAt: new Date().toISOString() }, null, 2), `${demo ? '示例' : '轻记账'}-${today()}.json`, 'application/json');
});
$('#export-csv').addEventListener('click', () => { if (secretSession) return; const records = getResults(); if (!records.length) { showToast('当前筛选没有记录可导出。'); return; } download(transactionsCsv(records), `${demo ? '示例' : '轻记账'}-${month}-明细.csv`, 'text/csv;charset=utf-8'); });
$('#export-raw').addEventListener('click', () => { try { const raw = window.localStorage.getItem(STORAGE_KEY); if (raw === null) throw new Error('浏览器中没有原始账本文件。'); download(raw, `轻记账-原始数据-${today()}.json`, 'application/json'); } catch (error) { showToast(error.message); } });
$('#import-trigger').addEventListener('click', () => { $('.data-menu').open = false; $('#import-file').click(); });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (demo) return;
  const session = secretSession;
  try {
    if (file.size > (session ? 8 : 4) * 1024 * 1024) throw new Error(`备份文件不能超过 ${session ? 8 : 4} MB。`);
    let content; try { content = JSON.parse(await file.text()); } catch { throw new Error('文件不是有效的 JSON，账本未改变。'); }
    if (session !== secretSession || demo) throw new Error('空间已切换，请重新选择备份。');
    if (!session && content?.kind === 'ran-jin-secret-ledger') throw new Error('秘密基地备份只能在秘密基地内恢复，不会导入总账。');
    pendingImport = session ? validateSecretBackup(content) : validateLedger(content);
    $('#import-description').textContent = session ? '此加密备份仅导入秘密基地，不影响总账。请输入备份使用的密码，并选择合并或替换。' : `文件包含 ${pendingImport.transactions.length} 条记录与 ${Object.keys(pendingImport.budgets).length} 个月的预算。${storageProblem ? '当前数据无法读取，请先保存原始数据；恢复备份将替换它。' : '请选择如何导入。'}`;
    $('#import-secret-password-label').hidden = !session;
    $('#import-secret-password').value = '';
    const merge = $('input[name="import-mode"][value="merge"]'); const replace = $('input[name="import-mode"][value="replace"]');
    merge.disabled = Boolean(storageProblem); merge.checked = !storageProblem; replace.checked = Boolean(storageProblem);
    clearError('#import-error'); $('#import-dialog').showModal();
  } catch (error) { showToast(`${error.message} 原有数据未改变。`); }
});
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#import-error');
  const session = secretSession;
  const pending = pendingImport;
  const password = $('#import-secret-password').value;
  $('#import-secret-password').value = '';
  try {
    if (demo) throw new Error('请先退出示例，再导入到自己的账本。');
    if (!pending) throw new Error('请重新选择备份文件。');
    const replace = $('input[name="import-mode"]:checked').value === 'replace';
    $('#import-form button[type="submit"]').disabled = true;
    const imported = session ? await decryptSecretBackup(pending, password) : pending;
    if (session !== secretSession || pending !== pendingImport) throw new Error('空间已锁定或导入已取消，请重新选择备份。');
    if (replace && !session) { ledger = replaceLedger(window.localStorage, imported); storageProblem = ''; }
    else await persist(state => replace ? imported : mergeLedgers(state, imported));
    resetFilters(); render(); $('#import-dialog').close(); pendingImport = null; showToast('备份已导入并保存。');
  } catch (error) { showError('#import-error', ['QuotaExceededError', 'SecurityError'].includes(error.name) ? new Error('导入未保存，请检查浏览器存储权限或可用空间。') : error); }
  finally { $('#import-form button[type="submit"]').disabled = saving; }
});

function exportSecretData() {
  try {
    const raw = window.localStorage.getItem(SECRET_STORAGE_KEY);
    if (raw === null) throw new Error('未找到秘密基地数据。');
    download(raw, `秘密基地-加密备份-${today()}.json`, 'application/json');
  } catch (error) { showToast(error.message); }
}
function resetPrivateView() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  ['#entry-form', '#budget-form', '#import-form', '#secret-form'].forEach(selector => $(selector).reset());
  $('#delete-description').textContent = ''; $('#import-description').textContent = '';
  editingRecord = deletingRecord = lastDeleted = pendingImport = secretBackup = null;
  clearTimeout(toastTimer); $('#toast').classList.remove('visible'); $('#toast-message').textContent = '';
  $('.data-menu').open = false;
  resetFilters();
}
function lockSecret(message = '秘密基地已锁定。') {
  secretAttempt?.abort(); secretAttempt = null;
  if (!secretSession) { $('#secret-password').value = $('#secret-confirm').value = ''; return; }
  secretSession.lock(); secretSession = null;
  clearTimeout(idleTimer);
  resetPrivateView(); loadRealLedger(); month = normalMonth || currentMonth(); render();
  showToast(message); $('#secret-entry').focus();
}
function refreshIdleTimer() {
  if (!secretSession) return;
  clearTimeout(idleTimer); idleTimer = setTimeout(() => lockSecret('秘密基地因 5 分钟未操作已自动锁定。'), 5 * 60 * 1000);
}
function renderSecretEntrance() {
  const restoring = Boolean(secretBackup);
  const creating = !secretHasStored && !restoring;
  $('#secret-title').textContent = restoring ? '恢复秘密基地' : creating ? '留一处秘密基地' : '进入秘密基地';
  $('#secret-description').textContent = restoring ? '请输入此加密备份的密码。恢复后只影响秘密基地，总账保持原样。' : creating ? '设一个只属于你的密码。这里的收支和预算独立保存，不计入总账；备份也会加密。' : '输入密码，回到只属于你的账本。';
  $('#secret-confirm-label').hidden = !creating;
  $('#secret-password').autocomplete = creating ? 'new-password' : 'current-password';
  $('#secret-replace-label').hidden = !(restoring && secretHasStored);
  $('#secret-export-locked').hidden = !secretHasStored;
  $('#secret-submit').textContent = restoring ? '恢复并进入' : creating ? '设置密码并进入' : '进入秘密基地';
}
$('#secret-entry').addEventListener('click', () => {
  if (secretSession) { lockSecret(); return; }
  if (saving) return;
  try { secretOriginal = window.localStorage.getItem(SECRET_STORAGE_KEY); secretHasStored = secretOriginal !== null; }
  catch { showToast('浏览器禁止本地存储，暂时无法打开秘密基地。'); return; }
  $('#secret-form').reset(); secretBackup = null; clearError('#secret-error');
  renderSecretEntrance(); $('#secret-dialog').showModal(); $('#secret-password').focus();
});
$('#secret-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#secret-error');
  if (secretAttempt) return;
  const password = $('#secret-password').value;
  const confirmation = $('#secret-confirm').value;
  const creating = !secretHasStored && !secretBackup;
  if (creating && password !== confirmation) { showError('#secret-error', new Error('两次输入的密码不一致，请重新输入。')); return; }
  if (secretBackup && secretHasStored && !$('#secret-replace').checked) { showError('#secret-error', new Error('恢复将替换秘密基地，请先保存现有加密数据，再勾选确认。')); return; }
  const attempt = new AbortController(); secretAttempt = attempt;
  const backup = secretBackup;
  $('#secret-password').value = $('#secret-confirm').value = '';
  $('#secret-submit').disabled = $('#secret-restore-trigger').disabled = true;
  try {
    const session = await openSecretLedger(window.localStorage, password, { create: creating, backup, signal: attempt.signal, expectedRaw: secretOriginal });
    normalMonth = demo ? realMonth : month;
    secretSession = session; ledger = session.ledger; storageProblem = ''; demo = null;
    secretAttempt = null; resetPrivateView(); month = currentMonth(); render(); refreshIdleTimer();
    $('#lock-secret').focus({ preventScroll: true });
    showToast(creating ? '秘密基地准备好了。记得单独导出加密备份。' : '欢迎回来。这里的收支不计入总账。');
  } catch (error) {
    if (!attempt.signal.aborted) { showError('#secret-error', ['QuotaExceededError', 'SecurityError'].includes(error.name) ? new Error('无法保存秘密基地，请检查本地存储权限与可用空间。原有数据未改变。') : error); $('#secret-password').focus(); }
  } finally {
    if (secretAttempt === attempt) secretAttempt = null;
    $('#secret-submit').disabled = $('#secret-restore-trigger').disabled = false;
  }
});
$('#secret-dialog').addEventListener('close', () => {
  secretAttempt?.abort(); secretAttempt = null;
  $('#secret-form').reset(); secretBackup = null;
});
$('#import-dialog').addEventListener('close', () => { $('#import-secret-password').value = ''; pendingImport = null; });
$('#secret-export-locked').addEventListener('click', exportSecretData);
$('#secret-restore-trigger').addEventListener('click', () => $('#secret-restore-file').click());
$('#secret-restore-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || secretAttempt) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('加密备份不能超过 8 MB。');
    const backup = validateSecretBackup(JSON.parse(await file.text()));
    if (!$('#secret-dialog').open || secretSession) return;
    secretBackup = backup; $('#secret-form').reset(); clearError('#secret-error'); renderSecretEntrance(); $('#secret-password').focus();
  } catch (error) { showError('#secret-error', error); }
});
$('#lock-secret').addEventListener('click', () => lockSecret());
['pointerdown', 'keydown'].forEach(name => document.addEventListener(name, refreshIdleTimer, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) lockSecret(); });
window.addEventListener('pagehide', () => lockSecret());

$('#privacy-button').addEventListener('click', () => $('#privacy-dialog').showModal());
$('#privacy-menu').addEventListener('click', () => { $('.data-menu').open = false; $('#privacy-dialog').showModal(); });
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.dialog-close, .cancel-dialog').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
});
document.addEventListener('click', event => { if (!event.target.closest('.data-menu')) $('.data-menu').open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('.data-menu').open = false; });
window.addEventListener('storage', event => {
  if ((event.key === SECRET_STORAGE_KEY || event.key === null) && secretSession) { lockSecret('秘密基地在其他窗口更新，已锁定。请重新进入查看最新记录。'); return; }
  if (!secretSession && (event.key === STORAGE_KEY || event.key === null)) { loadRealLedger(); render(); showToast('账本已根据其他窗口的更改刷新。'); }
});
document.querySelectorAll('.side-link').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('.side-link').forEach(item => item.classList.toggle('active', item === link)); }));
updateCategoryFilter(); render();
