import './style.css';
import { MAX_ORDERS, MAX_ARCHIVE_CHARS, emptyWardrobe, validateOrder, validateWardrobe, mergeWardrobes, moneyInput, formatMoney, today, stages, stageOf, timingLabel, dateLabel, rangeLabel, balanceLabel, summary, purchasedSummary, filteredOrders, demoWardrobe } from './model.js';
import { readWardrobe, readRawWardrobe, updateWardrobe } from './storage.js';
import { compressPhoto } from '../life/photos.js';
import { wardrobeCalendar } from './calendar.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const dressImage = `${import.meta.env.BASE_URL}lolita-dress.svg`;
let wardrobe = emptyWardrobe();
let loading = true;
let saving = false;
let storageProblem = '';
let loadGeneration = 0;
let demo = null;
let view = 'pending';
let stage = 'all';
let limit = 12;
let editing = null;
let paying = null;
let detail = null;
let deleting = null;
let lastDeleted = null;
let formPhotos = [];
let photoBusy = false;
let formGeneration = 0;
let pendingImport = null;
let importGeneration = 0;
let calendarSelection = null;
let toastTimer;
let renderedDate = today();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ran-jin-lolita-updates') : null;

const active = () => demo || wardrobe;
const readonly = () => Boolean(loading || saving || demo || storageProblem);
function error(selector, value) { $(selector).textContent = value.message || String(value); $(selector).hidden = false; }
function clearError(selector) { $(selector).textContent = ''; $(selector).hidden = true; }
function toast(message, undo = false) {
  $('#toast-message').textContent = message; $('#undo-delete').hidden = !undo;
  if (!undo) lastDeleted = null;
  $('#toast').classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), undo ? 12000 : 6500);
}
async function load() {
  const generation = ++loadGeneration;
  try { const next = await readWardrobe(); if (generation !== loadGeneration) return; wardrobe = next; storageProblem = ''; }
  catch { if (generation !== loadGeneration) return; storageProblem = '无法读取本地手账。原始数据不会被覆盖，请先保存原始数据，再恢复有效的 JSON 备份；也可以检查浏览器是否允许网站存储。'; }
  if (generation === loadGeneration) { loading = false; render(); }
}
async function persist(transform, { replace = false } = {}) {
  if (demo) throw new Error('示例仅供浏览，请先退出示例。');
  if (loading || saving) throw new Error('正在处理，请稍候再试。');
  if (storageProblem && !replace) throw new Error('请先保存原始数据，再恢复有效备份。');
  saving = true; render();
  try {
    const next = await updateWardrobe(transform, { replace });
    ++loadGeneration; wardrobe = next; storageProblem = ''; channel?.postMessage('changed');
  } catch (value) {
    if (['QuotaExceededError', 'SecurityError', 'UnknownError'].includes(value.name)) throw new Error('更改尚未保存，请检查浏览器存储权限或空间，并备份现有订单。');
    throw value;
  } finally { saving = false; render(); }
}
function originalOrder(state, snapshot) {
  const current = state.orders.find(order => order.id === snapshot.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error('这笔订单已在其他窗口修改或移除，请关闭窗口后重新打开。');
  return current;
}
function resetFilters() { stage = 'all'; $('#search-input').value = ''; $('#month-filter').value = ''; $('#sort-filter').value = 'due'; limit = 12; }
const results = () => filteredOrders(active().orders, { view, stage: view === 'purchased' ? 'all' : stage, search: $('#search-input').value, month: $('#month-filter').value, sort: $('#sort-filter').value });
function stat(number, label, value, note) { $(`#stat-${number}-label`).textContent = label; $(`#stat-${number}`).textContent = value; $(`#stat-${number}-note`).textContent = note; }
function sumNote(total) { return `${total.count} 笔订单${total.unknown ? ` · 另有 ${total.unknown} 笔金额待确认` : ''}`; }
function render() {
  renderedDate = today();
  const state = active(); const totals = summary(state.orders); const purchased = purchasedSummary(state.orders);
  $('#pending-count').textContent = totals.pending.count; $('#purchased-count').textContent = purchased.count;
  $('#view-pending').classList.toggle('selected', view === 'pending'); $('#view-pending').setAttribute('aria-pressed', String(view === 'pending'));
  $('#view-purchased').classList.toggle('selected', view === 'purchased'); $('#view-purchased').setAttribute('aria-pressed', String(view === 'purchased'));
  if (view === 'purchased') {
    stat('one', '已购买的小裙子', `${purchased.count} 条`, '每一条，都有它的心动故事');
    stat('two', '购买总花费', formatMoney(purchased.total), '已付定金 + 实付尾款');
    stat('three', '累计定金', formatMoney(purchased.deposit), '仅统计已付尾款的小裙子');
    stat('four', '实付尾款', formatMoney(purchased.balance), '以你填写的实际支付金额为准');
  } else {
    stat('one', '待补尾款', formatMoney(totals.pending.amount), sumNote(totals.pending));
    stat('two', '正在补款', formatMoney(totals.open.amount), sumNote(totals.open));
    stat('three', '未来 30 天准备', formatMoney(totals.soon.amount), sumNote(totals.soon));
    stat('four', '已付定金', formatMoney(totals.deposit), `包含已购 · 不含已取消${totals.unscheduled ? ` · ${totals.unscheduled} 笔时间待确认` : ''}`);
  }
  $('#summary-note').textContent = view === 'purchased' ? '已购总价使用实际付款金额，不含未录入的邮费或其他费用。金额汇总不受下方筛选影响。' : '合计只包含已填写金额，待确认部分另行标注。未来 30 天按日期范围重叠统计，每笔只计一次；时间与金额请以店铺公告为准。';
  $('#orders-title').replaceChildren(document.createTextNode(view === 'purchased' ? '已购买的小裙子' : '我的尾款手账'), make('span', '', '.'));
  $('#list-eyebrow').textContent = view === 'purchased' ? 'LITTLE DRESSES, LOVELY MEMORIES' : 'WAITING FOR SOMETHING LOVELY';
  $('#month-filter-label').textContent = view === 'purchased' ? '付款月份' : '补款月份';
  $('#sort-filter option[value="due"]').textContent = view === 'purchased' ? '最近付款' : '提醒优先';
  $('#storage-warning').hidden = !storageProblem; $('#storage-warning-text').textContent = storageProblem;
  $('#demo-notice').hidden = !demo; $('#demo-button').textContent = demo ? '退出示例 ↗' : '看看示例 ↗';
  $('#add-button').disabled = $('#empty-add').disabled = readonly();
  $('#demo-button').disabled = loading || saving;
  $('#import-trigger').disabled = $('#import-file').disabled = Boolean(loading || saving || demo);
  $('#export-json').textContent = demo ? '导出示例手账' : '备份全部订单与图片';
  $('#export-json').disabled = loading || saving;
  $('#save-order').disabled = readonly() || photoBusy;
  $('#confirm-pay').disabled = $('#confirm-delete').disabled = readonly();
  $('#confirm-import').disabled = loading || saving || Boolean(demo);
  $('#undo-delete').disabled = saving || loading || Boolean(demo || storageProblem);
  renderFilters(); renderOrders(); renderReminders();
}
function renderFilters() {
  const filters = [['all', '全部待补'], ['open', '补款中'], ['upcoming', '即将开始'], ['waiting', '等待补款'], ['unscheduled', '时间待定'], ['overdue', '超过预计'], ['cancelled', '已取消']];
  $('#stage-filters').hidden = view === 'purchased'; $('#stage-filters').replaceChildren();
  filters.forEach(([value, label]) => {
    const button = make('button', `stage-filter${stage === value ? ' selected' : ''}`, label);
    button.dataset.stage = value; button.setAttribute('aria-pressed', String(stage === value));
    button.addEventListener('click', () => { stage = value; limit = 12; renderFilters(); renderOrders(); $(`#stage-filters [data-stage="${value}"]`).focus({ preventScroll: true }); });
    $('#stage-filters').append(button);
  });
}
function renderOrders() {
  const orders = results(); $('#order-grid').replaceChildren(...orders.slice(0, limit).map(orderCard));
  $('#result-count').textContent = loading ? '正在打开本地手账…' : `${orders.length} 条${view === 'purchased' ? '已购小裙子' : '匹配订单'}${saving ? ' · 正在保存…' : ''}`;
  const filtered = stage !== 'all' || Boolean($('#search-input').value.trim() || $('#month-filter').value);
  $('#empty-state').hidden = loading || orders.length > 0;
  $('#empty-title').textContent = filtered ? '还没有找到这条小裙子' : view === 'purchased' ? '你的衣橱，等一份心动入住' : '把第一条心动的小裙子记下来';
  $('#empty-description').textContent = filtered ? '换个关键词、状态或月份，再看看吧。' : view === 'purchased' ? '补完尾款后，小裙子会带着图片和最终总价，\n自动出现在这里。' : '留下裙图和定金凭证，\n为下一次补款留一个提醒。';
  $('#empty-add').hidden = Boolean(filtered || demo || view === 'purchased' || storageProblem);
  $('#reset-filters').hidden = !filtered;
  $('#load-more').hidden = orders.length <= limit;
  $('#visible-count').textContent = orders.length ? `已展示 ${Math.min(orders.length, limit)} / ${orders.length} 条` : '一条一条，收好你的喜欢。';
}
function orderCard(order) {
  const card = make('article', 'order-card'); card.dataset.id = order.id;
  const photo = order.photos.find(item => item.kind === 'dress');
  const imageButton = make('button', `card-photo${photo ? '' : ' placeholder'}`); imageButton.setAttribute('aria-label', `查看${order.title}的订单详情`);
  const image = make('img'); image.src = photo?.data || dressImage; image.alt = photo ? `${order.title}的裙图` : '小裙子插画，尚未添加裙图'; image.loading = 'lazy';
  const state = stageOf(order); imageButton.append(image, make('span', `card-tag ${state}`, stages[state]));
  if (order.photos.length) imageButton.append(make('span', 'photo-count', `${order.photos.filter(item => item.kind === 'dress').length} 张裙图 · ${order.photos.filter(item => item.kind === 'receipt').length} 张凭证`));
  imageButton.addEventListener('click', () => openDetail(order));
  const content = make('div', 'card-content'); content.append(make('p', 'card-shop', order.shop || '未填写店铺'));
  const heading = make('h3', 'card-title'); const title = make('button', '', order.title); title.addEventListener('click', () => openDetail(order)); heading.append(title);
  content.append(heading, make('p', 'card-variant', order.variant || '颜色 / 尺码待补充'));
  const money = make('div', 'card-money'); const amount = make('div');
  amount.append(make('span', '', order.status === 'paid' ? '购买总价' : '待补尾款'), make('strong', '', order.status === 'paid' ? formatMoney(order.deposit + order.paidAmount) : balanceLabel(order)));
  const deposit = make('p', '', '已付定金'); deposit.append(make('b', '', formatMoney(order.deposit)));
  if (order.status === 'paid') deposit.append(document.createTextNode(`尾款 ${formatMoney(order.paidAmount)}`));
  money.append(amount, deposit); content.append(money);
  content.append(make('p', 'card-dates', order.status === 'paid' ? `${dateLabel(order.paidDate)} 补完尾款` : rangeLabel(order)), make('p', 'card-countdown', timingLabel(order)));
  const actions = make('div', 'card-actions'); const edit = make('button', 'text-button', '编辑记录 ↗'); edit.disabled = readonly(); edit.addEventListener('click', () => openOrder(order));
  const action = make('button', 'button secondary', order.status === 'pending' ? '已补尾款 ✓' : '看看详情 ↗'); action.disabled = order.status === 'pending' && readonly();
  action.addEventListener('click', () => order.status === 'pending' ? openPay(order) : openDetail(order));
  actions.append(edit, action); content.append(actions); card.append(imageButton, content); return card;
}
function renderReminders() {
  const pending = filteredOrders(active().orders, { stage: 'pending', sort: 'due' }).slice(0, 5);
  $('#reminder-list').replaceChildren();
  if (!pending.length) $('#reminder-list').append(make('p', 'reminder-empty', '现在没有待补订单。\n愿每一份心动都刚刚好。'));
  pending.forEach(order => {
    const button = make('button', 'reminder-item');
    button.append(make('small', '', `${stages[stageOf(order)]} · ${order.endDate ? dateLabel(order.endDate) : '等店铺公告'}`), make('strong', '', order.title), make('span', '', balanceLabel(order)));
    button.addEventListener('click', () => openDetail(order)); $('#reminder-list').append(button);
  });
  $('#calendar-button').disabled = $('#calendar-menu').disabled = loading || saving || !active().orders.some(order => order.status === 'pending' && order.startDate);
}
function switchView(next) { view = next; resetFilters(); render(); }
$('#view-pending').addEventListener('click', () => switchView('pending'));
$('#view-purchased').addEventListener('click', () => switchView('purchased'));
$('#search-input').addEventListener('input', () => { limit = 12; renderOrders(); });
['#month-filter', '#sort-filter'].forEach(selector => $(selector).addEventListener('change', () => { limit = 12; renderOrders(); }));
$('#reset-filters').addEventListener('click', () => { resetFilters(); render(); });
$('#load-more').addEventListener('click', () => { limit += 12; renderOrders(); });

function paidFields() {
  const paid = $('#order-status').value === 'paid'; $('#paid-fields').hidden = !paid;
  if (paid) { if (!$('#order-paid-date').value) $('#order-paid-date').value = today(); if (!$('#order-paid-amount').value) $('#order-paid-amount').value = $('#order-balance').value; }
  updateTotalPreview();
}
function updateTotalPreview() {
  try {
    const deposit = moneyInput($('#order-deposit').value || '0');
    const paid = $('#order-status').value === 'paid';
    const balance = moneyInput($(paid ? '#order-paid-amount' : '#order-balance').value, { optional: true });
    $('#order-total-preview').textContent = balance === null ? '尾款待确认，暂不计算总价。' : `${paid ? '购买总价' : '预期总价'}：${formatMoney(deposit + balance)} = 定金 ${formatMoney(deposit)} + ${paid ? '实付尾款' : '尾款'} ${formatMoney(balance)}。不含未录入的其他费用。`;
  } catch { $('#order-total-preview').textContent = '填写有效金额后，可以查看定金 + 尾款的合计。'; }
}
function openOrder(order = null) {
  if (readonly()) return;
  formGeneration++; editing = order; formPhotos = order ? order.photos.map(photo => ({ ...photo })) : []; photoBusy = false;
  $('#order-form').reset(); clearError('#order-error'); $('#photo-help').textContent = '支持 JPG、PNG、WebP，单张原图不超过 10 MB。图片会压缩后仅保存在本地。';
  const values = { title: order?.title || '', shop: order?.shop || '', variant: order?.variant || '', number: order?.orderNumber || '', deposit: order ? (order.deposit / 100).toFixed(2) : '', 'deposit-date': order?.depositDate || today(), balance: order?.balance == null ? '' : (order.balance / 100).toFixed(2), start: order?.startDate || '', end: order?.endDate || '', remind: order?.remindDays ?? 7, status: order?.status || 'pending', 'paid-amount': order?.paidAmount == null ? '' : (order.paidAmount / 100).toFixed(2), 'paid-date': order?.paidDate || '', note: order?.note || '' };
  Object.entries(values).forEach(([name, value]) => { $(`#order-${name}`).value = value; });
  $('#order-estimated').checked = order?.balanceEstimated ?? true;
  $('#order-dialog-title').textContent = order ? '更新这份小裙子记录' : '记录一条小裙子';
  $('#save-order').textContent = order ? '保存修改' : '保存这份期待';
  paidFields(); renderPhotos(); $('#order-dialog').showModal(); $('#order-title').focus();
}
$('#add-button').addEventListener('click', () => openOrder()); $('#empty-add').addEventListener('click', () => openOrder());
$('#order-status').addEventListener('change', paidFields);
['#order-deposit', '#order-balance', '#order-paid-amount'].forEach(selector => $(selector).addEventListener('input', updateTotalPreview));
$('#order-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#order-error');
  if (photoBusy || saving) return;
  const snapshot = editing;
  try {
    const status = $('#order-status').value; const start = $('#order-start').value; const end = $('#order-end').value;
    const order = validateOrder({ id: snapshot?.id || crypto.randomUUID(), title: $('#order-title').value, shop: $('#order-shop').value, variant: $('#order-variant').value, orderNumber: $('#order-number').value, deposit: moneyInput($('#order-deposit').value), depositDate: $('#order-deposit-date').value, balance: moneyInput($('#order-balance').value, { optional: true }), balanceEstimated: $('#order-estimated').checked, startDate: start || end, endDate: end || start, remindDays: Number($('#order-remind').value), status, paidAmount: status === 'paid' ? moneyInput($('#order-paid-amount').value) : null, paidDate: status === 'paid' ? $('#order-paid-date').value : '', photos: formPhotos, note: $('#order-note').value, createdAt: snapshot?.createdAt ?? Date.now(), updatedAt: Math.max(Date.now(), (snapshot?.updatedAt ?? 0) + 1) });
    await persist(state => {
      if (snapshot) { originalOrder(state, snapshot); return { ...state, orders: state.orders.map(item => item.id === order.id ? order : item) }; }
      if (state.orders.length >= MAX_ORDERS) throw new Error('订单已达 500 笔，请先备份归档。');
      return { ...state, orders: [...state.orders, order] };
    });
    $('#order-dialog').close(); view = order.status === 'paid' ? 'purchased' : 'pending'; resetFilters(); if (order.status === 'cancelled') stage = 'cancelled'; render();
    toast(order.status === 'paid' ? `小裙子已收入清单，总价 ${formatMoney(order.deposit + order.paidAmount)}。` : '这份期待，记好了。');
  } catch (value) { error('#order-error', value); }
});

function openImage(photo, label) { $('#full-image').src = photo.data; $('#full-image').alt = label; $('#download-image').href = photo.data; $('#image-dialog').showModal(); }
function renderPhotos() {
  ['dress', 'receipt'].forEach(kind => {
    const list = $(`#${kind}-previews`); list.replaceChildren();
    formPhotos.filter(photo => photo.kind === kind).forEach((photo, index) => {
      const wrapper = make('div', 'preview-photo'); const imageButton = make('button', 'preview-image'); imageButton.type = 'button'; imageButton.setAttribute('aria-label', `查看${kind === 'dress' ? '裙图' : '凭证'} ${index + 1}`);
      const image = make('img'); image.src = photo.data; image.alt = `${kind === 'dress' ? '裙图' : '定金凭证'} ${index + 1}`; imageButton.append(image); imageButton.addEventListener('click', () => openImage(photo, image.alt));
      const remove = make('button', 'remove-photo', '×'); remove.type = 'button'; remove.disabled = photoBusy || saving; remove.setAttribute('aria-label', `移除${image.alt}`);
      remove.addEventListener('click', () => { formPhotos = formPhotos.filter(item => item.id !== photo.id); renderPhotos(); }); wrapper.append(imageButton, remove); list.append(wrapper);
    });
    $(`#${kind}-files`).disabled = photoBusy || saving || formPhotos.filter(photo => photo.kind === kind).length >= 3;
  });
  $('#save-order').disabled = photoBusy || readonly();
}
async function addPhotos(event, kind) {
  const files = Array.from(event.target.files); event.target.value = ''; if (!files.length || photoBusy || readonly()) return;
  const generation = formGeneration; const remaining = 3 - formPhotos.filter(photo => photo.kind === kind).length;
  if (files.length > remaining) { error('#order-error', new Error(`同类图片最多 3 张，这次最多可以再添加 ${remaining} 张。`)); return; }
  photoBusy = true; clearError('#order-error'); renderPhotos(); $('#photo-help').textContent = '正在压缩图片，请稍候…';
  try {
    const photos = [];
    for (const file of files) photos.push({ id: crypto.randomUUID(), kind, data: await compressPhoto(file) });
    if (generation !== formGeneration || !$('#order-dialog').open) return;
    formPhotos.push(...photos); $('#photo-help').textContent = '图片已准备好，保存订单后才会写入手账。';
  } catch (value) { if (generation === formGeneration) error('#order-error', value); }
  finally { if (generation === formGeneration) { photoBusy = false; renderPhotos(); } }
}
$('#dress-files').addEventListener('change', event => addPhotos(event, 'dress')); $('#receipt-files').addEventListener('change', event => addPhotos(event, 'receipt'));
$('#order-dialog').addEventListener('close', () => { formGeneration++; formPhotos = []; photoBusy = false; editing = null; $('#order-form').reset(); $('#dress-previews').replaceChildren(); $('#receipt-previews').replaceChildren(); });

function openPay(order) {
  if (readonly()) return;
  paying = order; clearError('#pay-error'); $('#pay-description').textContent = `${order.title} · 已付定金 ${formatMoney(order.deposit)}`;
  $('#pay-amount').value = order.balance === null ? '' : (order.balance / 100).toFixed(2); $('#pay-date').value = today(); updatePayTotal(); $('#pay-dialog').showModal(); $('#pay-amount').focus();
}
function updatePayTotal() {
  try { $('#pay-total').textContent = `购买总价：${formatMoney(paying.deposit + moneyInput($('#pay-amount').value))}`; }
  catch { $('#pay-total').textContent = '填写实付尾款后，将按定金 + 实付尾款计算总价。'; }
}
$('#pay-amount').addEventListener('input', updatePayTotal);
$('#pay-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#pay-error'); const snapshot = paying;
  try {
    const updated = validateOrder({ ...snapshot, status: 'paid', paidAmount: moneyInput($('#pay-amount').value), paidDate: $('#pay-date').value, updatedAt: Math.max(Date.now(), snapshot.updatedAt + 1) });
    await persist(state => { originalOrder(state, snapshot); return { ...state, orders: state.orders.map(order => order.id === snapshot.id ? updated : order) }; });
    $('#pay-dialog').close(); switchView('purchased'); toast(`小裙子已收入清单，总价 ${formatMoney(updated.deposit + updated.paidAmount)}。`);
  } catch (value) { error('#pay-error', value); }
});

function openDetail(order) {
  detail = order; $('#detail-title').textContent = order.title; $('#detail-stage').textContent = stages[stageOf(order)];
  const content = $('#detail-content'); content.replaceChildren(); const info = make('dl', 'detail-info');
  const data = [['店铺 / 品牌', order.shop || '未填写'], ['颜色 / 尺码', order.variant || '未填写'], ['已付定金', `${formatMoney(order.deposit)} · ${dateLabel(order.depositDate)}`], [order.status === 'paid' ? '实付尾款' : '预计尾款', order.status === 'paid' ? formatMoney(order.paidAmount) : balanceLabel(order)], ['预计补款范围', rangeLabel(order)], ['提醒设置', `提前 ${order.remindDays} 天 · 截止当天再次提醒`], ['订单号', order.orderNumber || '未填写']];
  if (order.status === 'paid') data.push(['尾款支付日期', dateLabel(order.paidDate)], ['购买总价', formatMoney(order.deposit + order.paidAmount)]);
  else if (order.balance !== null) data.push(['预期总价', `${order.balanceEstimated ? '约 ' : ''}${formatMoney(order.deposit + order.balance)}`]);
  data.forEach(([label, value]) => { const item = make('div'); const dd = make('dd', label === '购买总价' ? 'detail-total' : '', value); item.append(make('dt', '', label), dd); info.append(item); });
  content.append(info, make('p', 'detail-note', order.note || '还没有留下备注。'));
  ['dress', 'receipt'].forEach(kind => {
    const photos = order.photos.filter(photo => photo.kind === kind); if (!photos.length) return;
    const section = make('section', 'detail-photos'); section.append(make('h3', '', kind === 'dress' ? '裙子的样子' : '定金付款凭证')); const grid = make('div', 'detail-photo-grid');
    photos.forEach((photo, index) => { const button = make('button', 'detail-photo'); button.setAttribute('aria-label', `放大${kind === 'dress' ? '裙图' : '定金凭证'} ${index + 1}`); const image = make('img'); image.src = photo.data; image.alt = `${order.title}的${kind === 'dress' ? '裙图' : '定金凭证'} ${index + 1}`; button.append(image); button.addEventListener('click', () => openImage(photo, image.alt)); grid.append(button); });
    section.append(grid); content.append(section);
  });
  if (order.status === 'pending' && order.startDate) { const calendar = make('button', 'button secondary', '导出这条裙子的日历提醒 ↗'); calendar.addEventListener('click', () => openCalendar([order])); content.append(calendar); }
  $('#detail-delete').disabled = $('#detail-edit').disabled = readonly(); $('#detail-dialog').showModal();
}
$('#detail-edit').addEventListener('click', () => { const order = detail; $('#detail-dialog').close(); openOrder(order); });
$('#detail-delete').addEventListener('click', () => { deleting = detail; $('#delete-description').textContent = detail.title; clearError('#delete-error'); $('#delete-dialog').showModal(); });
$('#confirm-delete').addEventListener('click', async () => {
  const snapshot = deleting; clearError('#delete-error');
  try { await persist(state => { originalOrder(state, snapshot); return { ...state, orders: state.orders.filter(order => order.id !== snapshot.id) }; }); lastDeleted = snapshot; $('#delete-dialog').close(); $('#detail-dialog').close(); toast('订单与图片已移除。', true); }
  catch (value) { error('#delete-error', value); }
});
$('#undo-delete').addEventListener('click', async () => {
  if (!lastDeleted) return; const order = lastDeleted;
  try { await persist(state => { if (state.orders.some(item => item.id === order.id)) throw new Error('该编号已存在，为避免覆盖，请重新查看。'); return { ...state, orders: [...state.orders, order] }; }); toast('小裙子记录已恢复。'); }
  catch (value) { toast(value.message); }
});

function download(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type })); const link = make('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); $('.data-menu').open = false;
}
function openCalendar(orders = null) {
  calendarSelection = orders; const selected = (orders || active().orders).filter(order => order.status === 'pending' && order.startDate);
  $('#calendar-description').textContent = `${demo ? '这是示例日历。' : ''}将导出 ${selected.length} 笔待补款订单，每笔对应一个包含预计日期范围的日历事件。`;
  clearError('#calendar-error'); $('#download-calendar').disabled = !selected.length; $('#calendar-dialog').showModal();
}
$('#calendar-button').addEventListener('click', () => openCalendar()); $('#calendar-menu').addEventListener('click', () => { $('.data-menu').open = false; openCalendar(); });
$('#download-calendar').addEventListener('click', () => {
  try {
    const orders = calendarSelection ? calendarSelection.map(snapshot => { const order = active().orders.find(item => item.id === snapshot.id); if (!order) throw new Error('订单已更改，请关闭窗口后重新导出。'); return order; }) : active().orders;
    download(wardrobeCalendar(orders), `${demo ? '示例-' : ''}裙期-尾款提醒-${today()}.ics`, 'text/calendar;charset=utf-8'); $('#calendar-dialog').close(); toast('日历已下载，记得导入日历应用并开启提醒。');
  } catch (value) { error('#calendar-error', value); }
});
$('#export-json').addEventListener('click', () => {
  if (storageProblem && !demo) { toast('请先保存原始数据，避免将空手账当作备份。'); return; }
  download(JSON.stringify({ ...active(), exportedAt: new Date().toISOString() }), `${demo ? '示例-' : ''}裙期-全部订单与图片-${today()}.json`, 'application/json');
});
$('#export-raw').addEventListener('click', async () => {
  try { const raw = await readRawWardrobe(); if (raw === null) throw new Error('没有找到原始手账。'); download(JSON.stringify(raw), `裙期-原始数据-${today()}.json`, 'application/json'); }
  catch (value) { toast(value.message); }
});
$('#import-trigger').addEventListener('click', () => { $('.data-menu').open = false; $('#import-file').click(); });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || demo || saving || loading) return;
  const generation = ++importGeneration;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('备份文件不能超过 32 MB。');
    const text = await file.text(); if (text.length > MAX_ARCHIVE_CHARS + 100_000) throw new Error('备份内容过大。');
    const incoming = validateWardrobe(JSON.parse(text));
    for (const order of incoming.orders) for (const photo of order.photos) {
      const image = new Image(); image.src = photo.data;
      try { await image.decode(); } catch { throw new Error('备份中有无法读取的图片，手账未改变。'); }
      if (generation !== importGeneration || demo) return;
    }
    if (generation !== importGeneration || demo) return;
    pendingImport = incoming; $('#import-description').textContent = `包含 ${incoming.orders.length} 笔订单、${incoming.orders.reduce((sum, order) => sum + order.photos.length, 0)} 张图片。${storageProblem ? '原有数据无法读取，请先保存原始数据，再选择替换恢复。' : '请选择恢复方式。'}`;
    const merge = $('input[name="import-mode"][value="merge"]'); const replace = $('input[name="import-mode"][value="replace"]'); merge.disabled = Boolean(storageProblem); merge.checked = !storageProblem; replace.checked = Boolean(storageProblem);
    clearError('#import-error'); $('#import-dialog').showModal();
  } catch (value) { if (generation === importGeneration) toast(`${value.message} 原有订单未改变。`); }
});
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault(); clearError('#import-error'); const incoming = pendingImport;
  try { if (!incoming) throw new Error('请重新选择备份。'); const replace = $('input[name="import-mode"]:checked').value === 'replace'; await persist(state => replace ? incoming : mergeWardrobes(state, incoming), { replace }); $('#import-dialog').close(); resetFilters(); render(); toast('手账与图片已恢复。'); }
  catch (value) { error('#import-error', value); }
});
$('#import-dialog').addEventListener('close', () => { pendingImport = null; importGeneration++; });

function toggleDemo() { if (saving || loading) return; importGeneration++; demo = demo ? null : demoWardrobe(); view = 'pending'; resetFilters(); render(); }
$('#demo-button').addEventListener('click', toggleDemo); $('#exit-demo').addEventListener('click', toggleDemo);
['#privacy-button', '#privacy-menu', '#footer-privacy'].forEach(selector => $(selector).addEventListener('click', () => { $('.data-menu').open = false; $('#privacy-dialog').showModal(); }));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.dialog-close, .cancel-dialog').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
});
$('#image-dialog').addEventListener('close', () => { $('#full-image').removeAttribute('src'); $('#download-image').removeAttribute('href'); });
$('#dismiss-toast').addEventListener('click', () => $('#toast').classList.remove('visible'));
document.addEventListener('click', event => { if (!event.target.closest('.data-menu')) $('.data-menu').open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('.data-menu').open = false; });
if (channel) channel.onmessage = () => load();
window.addEventListener('focus', () => { if (!saving) load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !saving) load(); });
setInterval(() => { if (!document.hidden && today() !== renderedDate) render(); }, 60_000);
render(); load();
