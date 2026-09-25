import { getSnapshot, getImageUrl, isConfigured, loadSettings, formatDate, el } from './app.js';

const status = document.getElementById('status');
const article = document.getElementById('snapshot');
const content = document.getElementById('content');

function showStatus(message, kind = 'info') {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = '';
  status.append(message);
}

// The article HTML came from another website, so it is cleaned again here
// before being shown. The cleaned result is built in a detached fragment so
// nothing (such as images) loads until we have checked it.
function cleanArticleHtml(html) {
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      node.setAttribute('data-file', node.getAttribute('src') || '');
      node.removeAttribute('src');
    }
  });
  return window.DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'svg', 'video', 'audio', 'source', 'link', 'meta'],
    FORBID_ATTR: ['style', 'class', 'id', 'srcset'],
  });
}

async function loadImages(id, images) {
  const queue = [...images];
  const worker = async () => {
    while (queue.length) {
      const img = queue.shift();
      try {
        img.src = await getImageUrl(id, img.dataset.file);
      } catch {
        img.alt = `[Image could not be loaded] ${img.alt || ''}`.trim();
        img.classList.add('missing');
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function load() {
  const id = new URLSearchParams(window.location.search).get('id') || '';
  if (!/^[a-z0-9][a-z0-9-]{4,99}$/.test(id)) {
    showStatus(el('span', {}, 'This snapshot link is not valid. ', el('a', { href: 'archive.html', text: 'Go to the archive' }), '.'), 'error');
    return;
  }
  if (!isConfigured()) {
    showStatus(el('span', {}, 'This snapshot is private. To view it on this device, add your access key in ', el('a', { href: 'settings.html', text: 'Settings' }), ', then reopen this link.'));
    return;
  }

  showStatus('Loading the snapshot…');
  let snapshot;
  try {
    snapshot = await getSnapshot(id);
  } catch (err) {
    showStatus(err.status === 404 ? 'This snapshot could not be found.' : err.message, 'error');
    return;
  }

  document.title = `${snapshot.title} · Webpage Archiver`;
  document.getElementById('site').textContent = snapshot.siteName || '';
  document.getElementById('title').textContent = snapshot.title;
  const bylineParts = [snapshot.byline, snapshot.publishedTime ? `Published ${formatDate(snapshot.publishedTime, { withTime: false })}` : null].filter(Boolean);
  document.getElementById('byline').textContent = bylineParts.join(' · ');
  document.getElementById('byline').hidden = bylineParts.length === 0;
  document.getElementById('captured').textContent = formatDate(snapshot.capturedAt);
  const original = document.getElementById('original');
  original.href = snapshot.url;
  original.textContent = snapshot.url;
  const warning = document.getElementById('warning');
  if (snapshot.warning) {
    warning.textContent = snapshot.warning;
    warning.hidden = false;
  }
  const { repo } = loadSettings();
  document.getElementById('view-files').href = `https://github.com/${repo}/tree/HEAD/snapshots/${id}`;
  document.getElementById('copy-link').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      event.target.textContent = 'Link copied';
    } catch {
      window.prompt('Copy this link:', window.location.href);
    }
  });

  const fragment = cleanArticleHtml(snapshot.contentHtml || '');
  if (snapshot.leadImage) {
    fragment.prepend(el('figure', { class: 'lead-image' }, el('img', { 'data-original-src': snapshot.leadImage.originalUrl, alt: '' })));
    fragment.querySelector('img').dataset.file = snapshot.leadImage.file;
  }

  const images = [];
  for (const img of fragment.querySelectorAll('img')) {
    const file = img.dataset.file || '';
    if (/^images\/[\w.-]+$/.test(file)) {
      img.dataset.file = file;
      img.loading = 'lazy';
      images.push(img);
    } else {
      img.remove();
    }
  }
  for (const link of fragment.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  content.replaceChildren(fragment);
  status.hidden = true;
  article.hidden = false;
  loadImages(id, images);
}

load();
