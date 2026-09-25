// Shared code for all Webpage Archiver pages: settings, talking to the
// GitHub API, and small display helpers.

export const DEFAULT_REPO = 'Simonh1982/Webpage_archiver_snapshots';
const WORKFLOW_FILE = 'capture.yml';
const API = 'https://api.github.com';
const STORAGE_KEY = 'webpage-archiver-settings';

// ---------- Settings (kept in this browser only) ----------

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    saved = {};
  }
  return { token: saved.token || '', repo: saved.repo || DEFAULT_REPO };
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function isConfigured() {
  return Boolean(loadSettings().token);
}

// ---------- GitHub API ----------

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json', settings = loadSettings() } = {}) {
  if (!settings.token) {
    throw new ApiError('No access key has been added yet. Open Settings to add one.', 0);
  }
  let response;
  try {
    response = await fetch(`${API}/repos/${settings.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach GitHub. Check your internet connection and try again.', 0);
  }
  if (!response.ok) {
    let message = `GitHub returned an error (${response.status}).`;
    if (response.status === 401) message = 'Your access key was not accepted. It may have expired. Open Settings to add a new one.';
    if (response.status === 403) message = 'Your access key does not have permission to do this. Check its permissions (see Settings).';
    if (response.status === 404) message = 'Not found.';
    throw new ApiError(message, response.status);
  }
  return response;
}

export async function getRepoInfo(settings) {
  return (await gh('', { settings })).json();
}

export async function checkWorkflow(settings) {
  return (await gh(`/actions/workflows/${WORKFLOW_FILE}`, { settings })).json();
}

export async function getRawFile(path) {
  return gh(`/contents/${path}`, { accept: 'application/vnd.github.raw' });
}

export async function getJsonFile(path) {
  return (await getRawFile(path)).json();
}

async function fileExists(path) {
  try {
    await gh(`/contents/${path}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

export async function getIndex() {
  try {
    const index = await getJsonFile('index.json');
    return Array.isArray(index.snapshots) ? index.snapshots : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

export async function getSnapshot(id) {
  return getJsonFile(`snapshots/${id}/snapshot.json`);
}

// Downloads an image from a snapshot and returns a URL the page can display.
export async function getImageUrl(id, file) {
  const response = await getRawFile(`snapshots/${id}/${file}`);
  return URL.createObjectURL(await response.blob());
}

// ---------- Capturing ----------

export function makeSnapshotId(url) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const random = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${host || 'page'}-${random}`;
}

// Asks GitHub to run the capture workflow. Returns the new snapshot's id.
export async function startCapture(url) {
  const id = makeSnapshotId(url);
  const repo = await getRepoInfo();
  try {
    await gh(`/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      body: { ref: repo.default_branch, inputs: { url, id } },
    });
  } catch (err) {
    if (err.status === 404) {
      throw new ApiError('The capture workflow could not be found in your snapshots repository. See the setup guide in the README.', 404);
    }
    throw err;
  }
  return id;
}

async function findRun(id) {
  const response = await gh(`/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`);
  const { workflow_runs: runs = [] } = await response.json();
  return runs.find((run) => run.display_title === `Capture ${id}`) || null;
}

// Waits until the capture has finished. Resolves with the snapshot id on
// success; rejects with a readable message on failure.
export async function waitForCapture(id, onProgress = () => {}) {
  const started = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  let polls = 0;
  let run = null;

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, polls === 0 ? 8000 : 5000));
    polls++;

    if (await fileExists(`snapshots/${id}/snapshot.json`)) return id;

    let failure = null;
    try {
      failure = await getJsonFile(`errors/${id}.json`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (failure) throw new ApiError(failure.error || 'The capture failed.', 0);

    if (polls % 2 === 0) {
      run = (await findRun(id).catch(() => null)) || run;
      if (run && run.status === 'completed' && run.conclusion !== 'success') {
        throw new ApiError(`The capture stopped unexpectedly (${run.conclusion}). The details are in the GitHub log: ${run.html_url}`, 0);
      }
    }
    onProgress({ seconds: Math.round((Date.now() - started) / 1000), run });
  }
  throw new ApiError('The capture is taking longer than expected. It may still finish. Check the archive in a few minutes.', 0);
}

// ---------- Display helpers ----------

export function formatDate(iso, { withTime = true } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function snapshotLink(id) {
  return `snapshot.html?id=${encodeURIComponent(id)}`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
