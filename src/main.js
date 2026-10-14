import './style.css';
import { profile, projects } from './profile.js';

const $ = (selector) => document.querySelector(selector);

document.querySelectorAll('[data-profile]').forEach((element) => {
  const value = profile[element.dataset.profile];
  if (typeof value === 'string') element.textContent = value;
});
document.title = `${profile.name} — 个人空间`;
$('meta[name="description"]').content = `${profile.name} · ${profile.affiliation}。${profile.intro.replaceAll('\n', '')}`;
$('.brand').setAttribute('aria-label', `${profile.name}，回到首页`);
$('#year').textContent = new Date().getFullYear();

function renderTags(container, tags) {
  container.replaceChildren(...tags.map((tag) => {
    const span = document.createElement('span');
    span.textContent = tag;
    return span;
  }));
}
renderTags($('#interests'), profile.interests);

function safeLink(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

const contactLink = $('#contact-link');
const email = profile.email.trim();
if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  contactLink.href = `mailto:${email}`;
  contactLink.textContent = '发一封邮件 ↗';
  contactLink.removeAttribute('target');
} else if (safeLink(profile.github)) {
  contactLink.href = safeLink(profile.github).href;
}

const thumbnails = {
  ledger: '<div class="journal-page"><div class="journal-top">LITTLE LEDGER <span>¥</span></div><span class="journal-title">把生活，<br>记清楚。</span><div class="journal-rule"></div><div class="journal-bottom"><span>TRACK / SAVE / GROW<br>每一笔，都值得记录。</span><span class="journal-star">＋</span></div></div><span class="journal-paper"></span>',
  garden: '<div class="mini-browser"><div class="browser-bar"><i></i><i></i><i></i><span>my little space</span></div><div class="mini-site"><div><small>HELLO, WORLD.</small><strong>保持好奇，<br>慢慢生长。</strong><span class="mini-site-button">探索我的世界 ↗</span></div><div class="mini-landscape"><span></span><i></i><b></b></div></div><div class="mini-site-footer">A LITTLE SPACE FOR BIG IDEAS <span>✳</span></div></div>',
  journal: '<div class="journal-page"><div class="journal-top">FIELD NOTES <span>NO. 001</span></div><span class="journal-title">把日常，<br>写成故事。</span><div class="journal-rule"></div><div class="journal-bottom"><span>A FEW LITTLE THINGS<br>WORTH REMEMBERING.</span><span class="journal-star">✳</span></div></div><span class="journal-paper"></span>',
  ideas: '<div class="ideas-sheet"><div class="ideas-top">THE IDEA CLUB <span>↗</span></div><div class="idea-shapes"><span class="shape-flower">✳</span><span class="shape-arch"></span><span class="shape-circle"></span><span class="shape-checker"></span></div><div class="ideas-bottom">好想法，慢慢来。<span>COLLECT / CREATE</span></div></div>',
};

const projectDialog = $('#project-dialog');
function openProject(project) {
  $('#dialog-title').textContent = project.title;
  $('#dialog-category').textContent = project.categoryLabel;
  $('#dialog-description').textContent = project.description;
  $('#dialog-status').textContent = project.status;
  renderTags($('#dialog-tags'), project.tags);
  const link = $('#dialog-link');
  const url = safeLink(project.url);
  link.hidden = !url;
  if (url) {
    link.href = url.href;
    link.textContent = `${project.linkLabel || '查看项目'} ↗`;
    const external = url.origin !== window.location.origin;
    if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else { link.removeAttribute('target'); link.removeAttribute('rel'); }
  }
  projectDialog.showModal();
}
$('#dialog-link').addEventListener('click', () => projectDialog.close());

const grid = $('#project-grid');
projects.forEach((project, index) => {
  const card = document.createElement('article');
  card.className = 'project-card';
  card.dataset.category = project.category;
  const button = document.createElement('button');
  button.className = 'project-open';
  button.setAttribute('aria-label', `查看${project.title}详情`);
  const thumbnail = document.createElement('div');
  thumbnail.className = `project-thumbnail thumbnail-${project.kind}`;
  thumbnail.setAttribute('aria-hidden', 'true');
  thumbnail.innerHTML = thumbnails[project.kind] || thumbnails.garden;
  const info = document.createElement('div');
  info.className = 'project-info';
  const meta = document.createElement('div');
  meta.className = 'project-meta';
  const category = document.createElement('span');
  category.textContent = `${String(index + 1).padStart(2, '0')} / ${project.categoryLabel}`;
  const status = document.createElement('span');
  status.className = 'project-badge';
  status.textContent = project.url ? '作品' : '概念示例';
  meta.append(category, status);
  const heading = document.createElement('h3');
  heading.textContent = project.title;
  const arrow = document.createElement('span');
  arrow.className = 'project-arrow';
  arrow.textContent = '↗';
  arrow.setAttribute('aria-hidden', 'true');
  const subtitle = document.createElement('p');
  subtitle.textContent = project.subtitle;
  info.append(meta, heading, arrow, subtitle);
  button.append(thumbnail, info);
  button.addEventListener('click', () => openProject(project));
  card.append(button);
  grid.append(card);
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let count = 0;
    document.querySelectorAll('.project-card').forEach((card) => {
      card.hidden = filter !== 'all' && card.dataset.category !== filter;
      if (!card.hidden) count++;
    });
    $('#filter-status').textContent = `显示 ${count} 个作品`;
  });
});

const menuButton = $('.menu-toggle');
const navigation = $('#navigation');
function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', '打开导航');
  navigation.classList.remove('is-open');
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  navigation.classList.toggle('is-open', open);
});
navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.header-inner')) closeMenu();
});
window.matchMedia('(min-width: 701px)').addEventListener('change', (event) => {
  if (event.matches) closeMenu();
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3000);
}
$('#copy-link').addEventListener('click', async () => {
  const url = new URL(window.location.href);
  url.hash = '';
  try {
    await navigator.clipboard.writeText(url.href);
    showToast('主页链接已复制，分享给朋友吧。');
  } catch {
    $('#share-url').value = url.href;
    $('#share-dialog').showModal();
    $('#share-url').focus();
    $('#share-url').select();
  }
});
