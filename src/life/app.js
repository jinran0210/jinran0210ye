import './style.css';
import { profile } from '../profile.js';
import { STORAGE_KEY, MAX_ARCHIVE_CHARS, categories, categoryById, emptyArchive, validateEvent, validateArchive, mergeArchives, filteredEvents, anniversaries, nextAnniversary, relativeDate, dateLabel, today, demoArchive } from './model.js';
import { readArchive, updateArchive, replaceArchive } from './storage.js';
import { compressPhoto, verifyPhotos } from './photos.js';

const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
$('#profile-name').textContent = profile.name;
let archive = emptyArchive();
let storageProblem = '';
let demo = null;
let selectedCategory = 'all';
let onlyStarred = false;
let limit = 20;
let editing = null;
let deleting = null;
let detail = null;
let photo = '';
let photoBusy = false;
let photoGeneration = 0;
let pendingImport = null;
let lastDeleted = null;
let toastTimer;

function load() {
  try { archive = readArchive(window.localStorage); storageProblem = ''; }
  catch { archive = emptyArchive(); storageProblem = '本地记录暂时无法读取，原始数据不会被覆盖。请先保存原始数据，再恢复有效备份；浏览器禁止存储时，请检查浏览器设置。'; }
}
load();
const active = () => demo || archive;
const results = () => filteredEvents(active().events, { category: selectedCategory, year: $('#year-filter').value, starred: onlyStarred, search: $('#search-input').value, sort: $('#sort-filter').value });
function error(selector, value) { $(selector).textContent = value.message || String(value); $(selector).hidden = false; }
function clearError(selector) { $(selector).textContent = ''; $(selector).hidden = true; }
function toast(message, undo = false) { $('#toast-message').textContent = message; $('#undo-delete').hidden = !undo; if (!undo) lastDeleted = null; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), undo ? 12000 : 6000); }
function persist(transform) {
  if (demo) throw new Error('请先退出示例，再编辑自己的记录。');
  if (storageProblem) throw new Error('请先保存原始数据，并恢复有效备份。');
  try { archive = updateArchive(window.localStorage, transform); render(); }
  catch (value) { if (['QuotaExceededError', 'SecurityError'].includes(value.name)) throw new Error('更改尚未保存。请减少照片、检查浏览器存储权限或空间，并备份现有记录。'); throw value; }
}
function updateYearFilter() {
  const selected = $('#year-filter').value;
  const years = [...new Set(active().events.map(event => event.date.slice(0, 4)))].sort().reverse();
  $('#year-filter').replaceChildren(new Option('全部年份', 'all'), ...years.map(year => new Option(`${year} 年`, year)));
  if (years.includes(selected)) $('#year-filter').value = selected;
}
function resetFilters() { selectedCategory = 'all'; onlyStarred = false; $('#year-filter').value = 'all'; $('#search-input').value = ''; $('#sort-filter').value = 'newest'; limit = 20; }
function counter(selector, number, unit) { $(selector).replaceChildren(document.createTextNode(String(number)), make('span', '', unit)); }

function render() {
  const state = active();
  updateYearFilter();
  counter('#event-count', state.events.length, '个');
  counter('#star-count', state.events.filter(event => event.starred).length, '个');
  counter('#year-count', new Set(state.events.map(event => event.date.slice(0, 4))).size, '年');
  const nearest = anniversaries(state.events)[0];
  $('#anniversary-title').textContent = nearest ? nearest.event.title : '还未设置';
  $('#anniversary-days').textContent = nearest ? `${dateLabel(nearest.next.date)} · ${nearest.next.days === 0 ? '就是今天' : `还有 ${nearest.next.days} 天`}` : '为重要的日子勾选“每年纪念”';
  $('#storage-warning').hidden = !storageProblem; $('#storage-warning-text').textContent = storageProblem;
  $('#demo-notice').hidden = !demo; $('#demo-button').textContent = demo ? '退出示例 ↗' : '看看示例 ↗';
  $('#add-button').disabled = Boolean(demo || storageProblem);
  $('#import-trigger').disabled = $('#import-file').disabled = Boolean(demo);
  $('#export-json').textContent = demo ? '导出示例时间线' : '导出全部记录与照片';
  renderTimeline();
}

function renderCategoryFilters() {
  $('#category-filters').replaceChildren();
  [{ id: 'all', name: '全部时刻' }, ...categories].forEach(category => {
    const button = make('button', 'category-filter', category.name); button.dataset.category = category.id;
    button.classList.toggle('selected', category.id === selectedCategory); button.setAttribute('aria-pressed', String(category.id === selectedCategory));
    button.addEventListener('click', () => { selectedCategory = category.id; limit = 20; renderTimeline(); $('#category-filters').querySelector(`[data-category="${category.id}"]`).focus(); });
    $('#category-filters').append(button);
  });
  $('#star-filter').classList.toggle('selected', onlyStarred); $('#star-filter').setAttribute('aria-pressed', String(onlyStarred)); $('#star-filter').textContent = onlyStarred ? '★ 重要时刻' : '☆ 重要时刻';
}

function renderTimeline() {
  renderCategoryFilters();
  const events = results();
  $('#result-count').textContent = `${events.length} 个时刻 · 让回忆有迹可循`;
  $('#timeline').replaceChildren();
  const groups = new Map();
  for (const event of events.slice(0, limit)) {
    const year = event.date.slice(0, 4);
    if (!groups.has(year)) {
      const section = make('section', 'year-group'); section.setAttribute('aria-label', `${year} 年的重要时刻`);
      const heading = make('h3', 'year-heading', year); heading.append(make('span', '', '这一年的故事'));
      const list = make('div', 'year-events'); section.append(heading, list); $('#timeline').append(section); groups.set(year, list);
    }
    groups.get(year).append(eventCard(event));
  }
  const filtered = selectedCategory !== 'all' || onlyStarred || $('#year-filter').value !== 'all' || Boolean($('#search-input').value.trim());
  $('#empty-state').hidden = events.length > 0;
  $('#empty-title').textContent = filtered ? '这一页，还没有匹配的故事' : '你的人生故事，从这里写下';
  $('#empty-description').textContent = filtered ? '换个关键词、分类或年份，再看看吧。' : '一次重要的决定、一场难忘的相遇，\n或一个让你为自己骄傲的日子。';
  $('#empty-add').hidden = Boolean(filtered || demo || storageProblem); $('#reset-filters').hidden = !filtered;
  $('#load-more').hidden = events.length <= limit;
  $('#visible-count').textContent = events.length ? `已展开 ${Math.min(events.length, limit)} / ${events.length} 个时刻` : '每一段人生，都值得被记住。';
}

function eventCard(event) {
  const category = categoryById[event.category];
  const card = make('article', `moment-card${event.starred ? ' starred-card' : ''}`); card.dataset.id = event.id;
  const top = make('div', 'moment-top');
  const tag = make('span', 'category-tag', category.name); tag.style.setProperty('--category-color', category.color);
  const date = make('time', 'moment-date', dateLabel(event.date)); date.dateTime = event.date;
  const labels = make('div', 'moment-labels'); labels.append(tag, date);
  if (event.date > today()) labels.append(make('span', 'future-tag', '待到来'));
  const star = make('button', 'moment-star', event.starred ? '★' : '☆'); star.setAttribute('aria-pressed', String(event.starred)); star.setAttribute('aria-label', `${event.starred ? '取消' : '添加'}重要标记：${event.title}`); star.disabled = Boolean(demo || storageProblem);
  star.addEventListener('click', () => {
    try { persist(state => { if (!state.events.some(item => item.id === event.id)) throw new Error('这个时刻已在其他窗口移除。'); return { ...state, events: state.events.map(item => item.id === event.id ? { ...item, starred: !item.starred, updatedAt: Math.max(Date.now(), item.updatedAt + 1) } : item) }; }); const replacement = document.querySelector(`.moment-card[data-id="${event.id}"] .moment-star`); (replacement || $('#star-filter')).focus({ preventScroll: true }); }
    catch (value) { toast(value.message); }
  });
  top.append(labels, star);
  const content = make('div', `moment-content${event.photo ? ' with-photo' : ''}`);
  const text = make('div', 'moment-text');
  const heading = make('h4'); const title = make('button', 'moment-title', event.title); title.setAttribute('aria-label', `查看故事：${event.title}`); title.addEventListener('click', () => openDetail(event)); heading.append(title);
  const story = make('p', 'moment-story', event.story || '为这个时刻留一个位置，故事可以慢慢补上。');
  text.append(heading, story);
  if (event.place) text.append(make('p', 'moment-place', `◎ ${event.place}`));
  content.append(text);
  if (event.photo) {
    const imageButton = make('button', 'moment-photo-button'); imageButton.setAttribute('aria-label', `查看${event.title}的照片`);
    const image = make('img', 'moment-photo'); image.src = event.photo; image.alt = `${event.title}的照片`; image.loading = 'lazy'; imageButton.append(image); imageButton.addEventListener('click', () => openDetail(event)); content.append(imageButton);
  }
  const bottom = make('div', 'moment-bottom');
  const timing = make('span', 'moment-timing', relativeDate(event.date));
  if (event.annual) timing.append(make('span', 'annual-badge', '每年纪念'));
  const actions = make('div', 'moment-actions');
  const edit = make('button', '', '编辑'); edit.setAttribute('aria-label', `编辑${event.title}`); edit.disabled = Boolean(demo || storageProblem); edit.addEventListener('click', () => openEntry(event));
  const remove = make('button', 'remove-action', '移除'); remove.setAttribute('aria-label', `移除${event.title}`); remove.disabled = Boolean(demo || storageProblem); remove.addEventListener('click', () => { deleting = { ...event }; $('#delete-description').textContent = `${dateLabel(event.date)} · ${event.title}`; clearError('#delete-error'); $('#delete-dialog').showModal(); });
  actions.append(edit, remove); bottom.append(timing, actions); card.append(top, content, bottom); return card;
}

function openDetail(event) {
  detail = { ...event };
  $('#detail-title').textContent = event.title;
  $('#detail-category').textContent = categoryById[event.category].name;
  $('#detail-meta').textContent = `${dateLabel(event.date)} · ${relativeDate(event.date)}${event.place ? ` · ${event.place}` : ''}`;
  $('#detail-story').textContent = event.story || '这个时刻的故事，还可以慢慢补上。';
  $('#detail-photo').hidden = !event.photo;
  if (event.photo) $('#detail-photo').src = event.photo; else $('#detail-photo').removeAttribute('src');
  const next = nextAnniversary(event); $('#detail-anniversary').hidden = !next;
  $('#detail-anniversary').textContent = next ? `下一个纪念日：${dateLabel(next.date)} · ${next.days === 0 ? '就是今天' : `还有 ${next.days} 天`}` : '';
  $('#detail-edit').hidden = Boolean(demo || storageProblem);
  $('#detail-dialog').showModal();
}
$('#detail-edit').addEventListener('click', () => { $('#detail-dialog').close(); openEntry(detail); });

function renderPhoto() {
  $('#photo-preview').hidden = !photo;
  if (photo) $('#photo-image').src = photo; else $('#photo-image').removeAttribute('src');
  $('#photo-button').textContent = photoBusy ? '正在压缩照片…' : photo ? '换一张照片' : '＋ 选择照片';
  $('#photo-button').disabled = photoBusy; $('#save-event').disabled = photoBusy;
}
function openEntry(event = null) {
  if (demo || storageProblem) return;
  editing = event ? { ...event } : null;
  photoGeneration++; photoBusy = false; photo = event?.photo || '';
  $('#entry-form').reset(); clearError('#entry-error');
  $('#entry-title').textContent = event ? '把这段故事写得更完整' : '记下一个重要时刻';
  $('#save-event').textContent = event ? '保存这段故事' : '珍藏这个时刻';
  $('#entry-name').value = event?.title || ''; $('#entry-date').value = event?.date || today();
  $('#entry-category').value = event?.category || 'growth'; $('#entry-place').value = event?.place || ''; $('#entry-story').value = event?.story || '';
  $('#entry-starred').checked = event?.starred || false; $('#entry-annual').checked = event?.annual || false;
  renderPhoto(); $('#entry-dialog').showModal(); $('#entry-name').focus();
}
$('#entry-category').replaceChildren(...categories.map(category => new Option(category.name, category.id)));
$('#add-button').addEventListener('click', () => openEntry()); $('#empty-add').addEventListener('click', () => openEntry());
$('#photo-button').addEventListener('click', () => $('#photo-file').click());
$('#photo-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const generation = ++photoGeneration; photoBusy = true; clearError('#entry-error'); renderPhoto();
  try { const result = await compressPhoto(file); if (generation === photoGeneration && $('#entry-dialog').open) photo = result; }
  catch (value) { if (generation === photoGeneration) error('#entry-error', value); }
  finally { if (generation === photoGeneration) { photoBusy = false; renderPhoto(); } }
});
$('#remove-photo').addEventListener('click', () => { photoGeneration++; photoBusy = false; photo = ''; renderPhoto(); });
$('#entry-dialog').addEventListener('close', () => { photoGeneration++; photoBusy = false; });
$('#entry-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('#entry-error');
  try {
    if (photoBusy) throw new Error('照片还在压缩，请稍等片刻。');
    const now = Date.now();
    const record = validateEvent({ id: editing?.id || crypto.randomUUID(), title: $('#entry-name').value.trim(), date: $('#entry-date').value, category: $('#entry-category').value, place: $('#entry-place').value.trim(), story: $('#entry-story').value.trim(), starred: $('#entry-starred').checked, annual: $('#entry-annual').checked, photo, createdAt: editing?.createdAt ?? now, updatedAt: Math.max(now, (editing?.updatedAt ?? now - 1) + 1) });
    persist(state => {
      if (editing) {
        const previous = state.events.find(item => item.id === editing.id);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(editing)) throw new Error('这段故事已在其他窗口更改，请关闭后重新打开编辑。');
        return { ...state, events: state.events.map(item => item.id === record.id ? record : item) };
      }
      return { ...state, events: [...state.events, record] };
    });
    resetFilters(); render(); $('#entry-dialog').close(); const target = document.querySelector(`.moment-card[data-id="${record.id}"] .moment-title`); (target || $('#add-button')).focus({ preventScroll: true }); toast(editing ? '故事已更新，回忆好好收着。' : '又一个重要时刻，被好好珍藏了。');
  } catch (value) { error('#entry-error', value); }
});

$('#confirm-delete').addEventListener('click', () => {
  clearError('#delete-error');
  try { persist(state => { const existing = state.events.find(item => item.id === deleting.id); if (!existing || JSON.stringify(existing) !== JSON.stringify(deleting)) throw new Error('记录已在其他窗口更改，请重新查看后再移除。'); return { ...state, events: state.events.filter(item => item.id !== deleting.id) }; }); lastDeleted = deleting; $('#delete-dialog').close(); toast('这个时刻已移除。', true); }
  catch (value) { error('#delete-error', value); }
});
$('#undo-delete').addEventListener('click', () => { if (!lastDeleted) return; try { const event = lastDeleted; persist(state => ({ ...state, events: state.events.some(item => item.id === event.id) ? state.events : [...state.events, event] })); toast('时刻和照片已恢复。'); } catch (value) { toast(value.message, true); } });
$('#dismiss-toast').addEventListener('click', () => $('#toast').classList.remove('visible'));

$('#search-input').addEventListener('input', () => { limit = 20; renderTimeline(); });
['#year-filter', '#sort-filter'].forEach(selector => $(selector).addEventListener('change', () => { limit = 20; renderTimeline(); }));
$('#star-filter').addEventListener('click', () => { onlyStarred = !onlyStarred; limit = 20; renderTimeline(); });
$('#reset-filters').addEventListener('click', () => { resetFilters(); renderTimeline(); });
$('#load-more').addEventListener('click', () => { limit += 20; renderTimeline(); });
function toggleDemo() { demo = demo ? null : demoArchive(); resetFilters(); render(); }
$('#demo-button').addEventListener('click', toggleDemo); $('#exit-demo').addEventListener('click', toggleDemo);

function download(data, filename) { const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const link = make('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); $('.backup-menu').open = false; }
$('#export-json').addEventListener('click', () => { if (storageProblem && !demo) { toast('请先保存原始数据，避免把空档案当作备份。'); return; } download(JSON.stringify({ ...active(), exportedAt: new Date().toISOString() }, null, 2), `${demo ? '示例时间线' : '人生大事'}-${today()}.json`); });
$('#export-raw').addEventListener('click', () => { try { const raw = window.localStorage.getItem(STORAGE_KEY); if (raw === null) throw new Error('没有可导出的原始记录。'); download(raw, `人生大事-原始数据-${today()}.json`); } catch (value) { toast(value.message); } });
$('#import-trigger').addEventListener('click', () => { $('.backup-menu').open = false; $('#import-file').click(); });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file || demo) return;
  try {
    if (file.size > MAX_ARCHIVE_CHARS * 4) throw new Error('备份文件过大，请使用本工具导出的 JSON 备份。');
    let raw; try { raw = JSON.parse(await file.text()); } catch { throw new Error('备份不是有效的 JSON。'); }
    const incoming = validateArchive(raw); await verifyPhotos(incoming.events);
    if (demo) throw new Error('请退出示例后再导入自己的记录。');
    pendingImport = incoming;
    $('#import-description').textContent = `备份包含 ${incoming.events.length} 个时刻和 ${incoming.events.filter(item => item.photo).length} 张照片。${storageProblem ? '当前数据无法读取，请先保存原始数据；恢复时将替换它。' : '请选择恢复方式。'}`;
    const merge = $('input[name="import-mode"][value="merge"]'); const replace = $('input[name="import-mode"][value="replace"]'); merge.disabled = Boolean(storageProblem); merge.checked = !storageProblem; replace.checked = Boolean(storageProblem);
    clearError('#import-error'); $('#import-dialog').showModal();
  } catch (value) { toast(`${value.message} 原有记录未改变。`); }
});
$('#import-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('#import-error');
  try {
    if (demo) throw new Error('请先退出示例，再恢复自己的记录。');
    if ($('input[name="import-mode"]:checked').value === 'replace') { archive = replaceArchive(window.localStorage, pendingImport); storageProblem = ''; }
    else persist(state => mergeArchives(state, pendingImport));
    resetFilters(); render(); $('#import-dialog').close(); pendingImport = null; toast('时刻与照片已恢复并保存。');
  } catch (value) { error('#import-error', ['QuotaExceededError', 'SecurityError'].includes(value.name) ? new Error('备份尚未保存。请检查浏览器空间与存储权限；原有数据未改变。') : value); }
});

['#privacy-button', '#privacy-menu', '#footer-privacy'].forEach(selector => $(selector).addEventListener('click', () => { $('.backup-menu').open = false; $('#privacy-dialog').showModal(); }));
document.querySelectorAll('dialog').forEach(dialog => { dialog.querySelectorAll('.dialog-close, .cancel-dialog').forEach(button => button.addEventListener('click', () => dialog.close())); dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } }); });
document.addEventListener('click', event => { if (!event.target.closest('.backup-menu')) $('.backup-menu').open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('.backup-menu').open = false; });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  load(); render();
  if ($('#detail-dialog').open && !active().events.some(item => item.id === detail?.id)) $('#detail-dialog').close();
  toast('记录已根据其他窗口的更改刷新。');
});
render();
