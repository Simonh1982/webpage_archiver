// Saves the output of capture.js into the snapshots repository as a single
// commit, and adds the new snapshot to index.json.
//
// It uses the GitHub API rather than a git checkout, so each capture does not
// have to download the whole (ever-growing) archive.
//
// Inputs (environment variables):
//   OUT_DIR            the folder capture.js wrote to (default "out")
//   CAPTURE_ID         the snapshot id
//   GITHUB_TOKEN       token with permission to write to the repository
//   GITHUB_REPOSITORY  "owner/repo" (set automatically by GitHub Actions)

import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = process.env.OUT_DIR || 'out';
const id = process.env.CAPTURE_ID;
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';

async function api(method, endpoint, body, accept = 'application/vnd.github+json') {
  const response = await fetch(`${apiBase}/repos/${repository}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error(`${method} ${endpoint} failed: ${response.status} ${await response.text()}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return accept.endsWith('raw') ? response.text() : response.json();
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

async function createBlob(content) {
  const blob = await api('POST', '/git/blobs', { content: content.toString('base64'), encoding: 'base64' });
  return blob.sha;
}

async function readIndex(commitSha) {
  try {
    // The "raw" format works for files of any size (the default JSON format stops at 1 MB).
    const text = await api('GET', `/contents/index.json?ref=${commitSha}`, null, 'application/vnd.github.raw');
    const data = JSON.parse(text);
    return Array.isArray(data.snapshots) ? data : { snapshots: [] };
  } catch (err) {
    if (err.status === 404) return { snapshots: [] };
    throw err;
  }
}

async function main() {
  if (!id || !token || !repository) throw new Error('CAPTURE_ID, GITHUB_TOKEN and GITHUB_REPOSITORY are required');

  const files = await listFiles(outDir);
  if (files.length === 0) throw new Error(`capture.js produced no output in ${outDir}`);

  // Upload every file once; the blobs can be reused if we need to retry.
  const tree = [];
  for (const file of files) {
    const repoPath = path.relative(outDir, file).split(path.sep).join('/');
    tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: await createBlob(await fs.readFile(file)) });
  }

  let entry = null;
  const snapshotFile = path.join(outDir, 'snapshots', id, 'snapshot.json');
  const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8').catch(() => 'null'));
  if (snapshot) {
    entry = {
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      title: snapshot.title,
      url: snapshot.url,
      siteName: snapshot.siteName,
      ...(snapshot.warning ? { warning: true } : {}),
    };
  }

  const { default_branch: branch } = await api('GET', '');

  // Another capture may finish at the same moment, so retry if the branch moved.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const ref = await api('GET', `/git/ref/heads/${branch}`);
    const headSha = ref.object.sha;
    const headCommit = await api('GET', `/git/commits/${headSha}`);

    const commitTree = [...tree];
    if (entry) {
      const index = await readIndex(headSha);
      index.snapshots = index.snapshots.filter((s) => s.id !== entry.id);
      index.snapshots.push(entry);
      index.snapshots.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      index.updatedAt = new Date().toISOString();
      const indexJson = Buffer.from(JSON.stringify(index, null, 2) + '\n');
      commitTree.push({ path: 'index.json', mode: '100644', type: 'blob', sha: await createBlob(indexJson) });
    }

    const newTree = await api('POST', '/git/trees', { base_tree: headCommit.tree.sha, tree: commitTree });
    const message = entry ? `Capture ${id}: ${entry.title}` : `Failed capture ${id}`;
    const commit = await api('POST', '/git/commits', { message, tree: newTree.sha, parents: [headSha] });

    try {
      await api('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
      console.log(`Saved ${entry ? 'snapshot' : 'error report'} ${id} (commit ${commit.sha.slice(0, 7)})`);
      return;
    } catch (err) {
      if (err.status !== 422 || attempt === 6) throw err;
      console.log(`Branch moved while saving; retrying (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

await main();
