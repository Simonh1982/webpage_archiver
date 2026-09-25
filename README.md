# Webpage Archiver

A simple web app for saving readable copies of webpages (typically news
articles) for research. Paste an address, press **Save**, and the app stores
the page's headline, text and images in your own private GitHub repository,
with a permanent link you can come back to.

## How it works

```
 You (browser)                 GitHub
 ─────────────                 ──────
 Web app  ── "please capture" ──▶  Snapshots repository (private)
 (GitHub Pages, this repo)            │  runs the "Capture webpage" workflow:
                                       │  opens the page in Chrome, extracts the
                                       │  text and images, saves a snapshot
 Snapshot / archive pages ◀─ reads ───┘
```

* **This repository (public)** holds the app and the capture program. It
  contains no captured articles.
* **[Webpage_archiver_snapshots](https://github.com/Simonh1982/Webpage_archiver_snapshots)
  (private)** holds the snapshots. Only people with an access key can see them.

Each capture takes about a minute and uses GitHub Actions minutes. GitHub Free
includes 2,000 minutes a month for private repositories, which is enough for
roughly 1,000 captures.

## One-off setup

### 1. Turn on the website (GitHub Pages)

1. In this repository, click **Settings** (the cog tab along the top).
2. In the left-hand menu, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
5. After a minute or two the app will be live at
   **https://simonh1982.github.io/webpage_archiver/**

### 2. Create an access key

The app needs a key so that it can start captures and read your private
snapshots.

1. On GitHub, click your profile picture (top right) → **Settings**.
2. At the bottom of the left-hand menu, click **Developer settings**.
3. Click **Personal access tokens → Fine-grained tokens → Generate new token**.
4. Fill in:
   * **Token name:** `Webpage Archiver`
   * **Expiration:** choose a date (for example 1 year). You will need to make a
     new key when it expires.
   * **Repository access:** **Only select repositories** → choose
     **Webpage_archiver_snapshots**.
   * **Permissions → Repository permissions:**
     * **Actions:** Read and write
     * **Contents:** Read-only
     * (Metadata: Read-only is added automatically.)
5. Click **Generate token** and copy the key (it starts `github_pat_`). GitHub
   shows it only once.

### 3. Add the key to the app

1. Open the app and click **Settings**.
2. Paste the key and click **Save and test**. You should see
   "Connected and saved".

Repeat this step on each device you use (for example, your phone). The key is
stored only in that browser. Treat it like a password and don't share it.

## Using the app

* **Save a page:** paste the address on the home page and press **Save**. Keep
  the page open for about a minute; the snapshot opens when it's ready.
* **Explore archive:** lists every snapshot with its capture date, title and
  original address. You can search, sort by clicking a column heading, and
  download the list as a CSV file.
* **Snapshot links** look like
  `https://simonh1982.github.io/webpage_archiver/snapshot.html?id=20260925-143012-example-com-ab12`
  and never change. They only work in a browser that has your access key.

## Limitations

* Sites with a hard paywall, or strong anti-bot protection, may refuse the
  capture. The app will tell you when this happens. Sites with a "soft"
  paywall (the full text is in the page but hidden) often work.
* A snapshot flagged with ⚠ captured only a small amount of text and may be
  incomplete.
* Pages are simplified for reading. The layout, adverts and interactive
  elements aren't kept, but a compressed copy of the full original page
  (`page.html.gz`) is saved alongside each snapshot.

## Files in this repository

| Location | Purpose |
| --- | --- |
| `index.html`, `archive.html`, `snapshot.html`, `settings.html` | The app's pages |
| `assets/` | The app's styles and scripts |
| `capture/` | The capture program run by GitHub Actions |
| `setup/capture.yml` | Reference copy of the workflow in the snapshots repository |
