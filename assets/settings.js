import { loadSettings, saveSettings, clearSettings, getRepoInfo, checkWorkflow, DEFAULT_REPO } from './app.js';

const form = document.getElementById('settings-form');
const tokenInput = document.getElementById('token');
const repoInput = document.getElementById('repo');
const status = document.getElementById('status');

const current = loadSettings();
tokenInput.value = current.token;
repoInput.value = current.repo;

function showStatus(message, kind = 'info') {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = message;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = {
    token: tokenInput.value.trim(),
    repo: repoInput.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '') || DEFAULT_REPO,
  };
  repoInput.value = settings.repo;
  if (!settings.token) {
    showStatus('Please paste your access key first.', 'error');
    return;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(settings.repo)) {
    showStatus('The repository should look like owner/name.', 'error');
    return;
  }

  showStatus('Testing the connection…');
  try {
    await getRepoInfo(settings);
  } catch (err) {
    showStatus(err.status === 404
      ? `The repository ${settings.repo} could not be found. Check the name, and that your access key was given access to it.`
      : err.message, 'error');
    return;
  }
  try {
    await checkWorkflow(settings);
  } catch (err) {
    showStatus(err.status === 404
      ? 'Connected, but the capture workflow was not found in the repository. See the setup guide in the README.'
      : `Connected to the repository, but your access key cannot use GitHub Actions: ${err.message}`, 'error');
    return;
  }

  try {
    saveSettings(settings);
  } catch {
    showStatus('Connected, but this browser would not let the settings be saved (private browsing can cause this).', 'error');
    return;
  }
  showStatus('Connected and saved. You can now save pages and view your archive on this device.', 'success');
});

document.getElementById('clear').addEventListener('click', () => {
  clearSettings();
  tokenInput.value = '';
  repoInput.value = DEFAULT_REPO;
  showStatus('Your access key has been removed from this device.', 'success');
});
