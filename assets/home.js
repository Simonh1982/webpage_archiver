import { isConfigured, startCapture, waitForCapture, snapshotLink } from './app.js';

const form = document.getElementById('capture-form');
const input = document.getElementById('url');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

document.getElementById('setup-notice').hidden = isConfigured();

function showStatus(message, kind = 'info') {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = message;
}

function readUrl() {
  let value = input.value.trim();
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = readUrl();
  if (!url) {
    showStatus('Please paste a full web address, for example https://www.example.com/news/article', 'error');
    input.focus();
    return;
  }

  saveButton.disabled = true;
  input.disabled = true;
  try {
    showStatus('Starting the capture…');
    const id = await startCapture(url);
    showStatus('Capturing the page. This usually takes about a minute, so please keep this page open.');
    await waitForCapture(id, ({ seconds, run }) => {
      const stage = run && run.status === 'in_progress' ? 'Capturing the page' : 'Waiting for GitHub to start the capture';
      showStatus(`${stage}… (${seconds} seconds so far). This usually takes about a minute, so please keep this page open.`);
    });
    showStatus('Saved. Opening the snapshot…', 'success');
    window.location.href = snapshotLink(id);
  } catch (err) {
    showStatus(err.message, 'error');
    saveButton.disabled = false;
    input.disabled = false;
  }
});
