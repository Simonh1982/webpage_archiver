import { getIndex, isConfigured, formatDate, snapshotLink, el } from './app.js';

const table = document.getElementById('archive');
const tbody = table.querySelector('tbody');
const filter = document.getElementById('filter');
const count = document.getElementById('count');
const status = document.getElementById('status');
const csvButton = document.getElementById('download-csv');

let snapshots = [];
let sortKey = 'capturedAt';
let sortAscending = false;

function showStatus(message, kind = 'info') {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = '';
  status.append(message);
}

function visibleSnapshots() {
  const query = filter.value.trim().toLowerCase();
  const matches = snapshots.filter((s) => !query || `${s.title} ${s.url} ${s.siteName || ''}`.toLowerCase().includes(query));
  return matches.sort((a, b) => {
    const result = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'en-GB', { sensitivity: 'base' });
    return sortAscending ? result : -result;
  });
}

function render() {
  const rows = visibleSnapshots();
  tbody.replaceChildren(...rows.map((s) => el('tr', {},
    el('td', { 'data-label': 'Captured' }, el('time', { datetime: s.capturedAt, text: formatDate(s.capturedAt) })),
    el('td', { 'data-label': 'Title' },
      el('a', { href: snapshotLink(s.id), text: s.title || '(untitled)' }),
      s.warning ? el('span', { class: 'flag', title: 'This snapshot may be incomplete', text: ' ⚠' }) : null,
      s.siteName ? el('span', { class: 'site', text: s.siteName }) : null),
    el('td', { 'data-label': 'Address', class: 'url' },
      el('a', { href: s.url, rel: 'noopener noreferrer', target: '_blank', text: s.url })),
  )));
  count.textContent = filter.value.trim()
    ? `Showing ${rows.length} of ${snapshots.length} snapshots`
    : `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}`;
  for (const button of table.querySelectorAll('.sort')) {
    const th = button.closest('th');
    if (button.dataset.sort === sortKey) th.setAttribute('aria-sort', sortAscending ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
}

function downloadCsv() {
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [['Date captured', 'Title', 'Site', 'Original address', 'Snapshot link'].map(quote).join(',')];
  const base = new URL('.', window.location.href);
  for (const s of visibleSnapshots()) {
    lines.push([s.capturedAt, s.title, s.siteName, s.url, new URL(snapshotLink(s.id), base).href].map(quote).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const link = el('a', { href: URL.createObjectURL(blob), download: 'webpage-archive.csv' });
  document.body.append(link);
  link.click();
  link.remove();
}

async function load() {
  if (!isConfigured()) {
    showStatus(el('span', {}, 'To see the archive on this device, add your access key in ', el('a', { href: 'settings.html', text: 'Settings' }), '.'));
    return;
  }
  showStatus('Loading the archive…');
  try {
    snapshots = await getIndex();
  } catch (err) {
    showStatus(err.message, 'error');
    return;
  }
  if (snapshots.length === 0) {
    showStatus(el('span', {}, 'Nothing has been saved yet. ', el('a', { href: './', text: 'Save your first page' }), '.'));
    count.textContent = '0 snapshots';
    return;
  }
  status.hidden = true;
  table.hidden = false;
  csvButton.disabled = false;
  render();
}

filter.addEventListener('input', render);
csvButton.addEventListener('click', downloadCsv);
for (const button of table.querySelectorAll('.sort')) {
  button.addEventListener('click', () => {
    if (sortKey === button.dataset.sort) sortAscending = !sortAscending;
    else {
      sortKey = button.dataset.sort;
      sortAscending = sortKey !== 'capturedAt';
    }
    render();
  });
}

load();
