// Captures one webpage: loads it in a real Chrome browser, extracts the
// headline, article text and images, and writes the result into OUT_DIR.
//
// Inputs (environment variables):
//   CAPTURE_URL  the page to capture
//   CAPTURE_ID   the snapshot id chosen by the web app
//   OUT_DIR      where to write the result (default "out")
//   CHROME_PATH  optional path to a Chrome/Chromium executable (for local testing)
//
// Output, on success:
//   OUT_DIR/snapshots/<id>/snapshot.json
//   OUT_DIR/snapshots/<id>/images/…
//   OUT_DIR/snapshots/<id>/page.html.gz   (the full rendered page, for reference)
// Output, on failure:
//   OUT_DIR/errors/<id>.json

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';

const TOOL_VERSION = 1;
const MAX_IMAGES = 60;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_TEXT_LENGTH = 200;   // below this we treat the capture as failed
const LOW_TEXT_LENGTH = 1200;  // below this we save it, but with a warning

const BLOCKED_TITLES = [
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /are you a robot/i,
  /verify you are human/i,
  /security check/i,
  /captcha/i,
];

const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

class CaptureError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

async function main() {
  const url = (process.env.CAPTURE_URL || '').trim();
  const id = (process.env.CAPTURE_ID || '').trim();
  const outDir = process.env.OUT_DIR || 'out';

  if (!/^[a-z0-9][a-z0-9-]{4,99}$/.test(id)) {
    throw new Error(`Invalid snapshot id: "${id}"`);
  }

  const capturedAt = new Date().toISOString();
  try {
    if (!/^https?:\/\//i.test(url)) throw new CaptureError('The address must start with http:// or https://');
    const snapshot = await capture(url, id, capturedAt, path.join(outDir, 'snapshots', id));
    console.log(`Captured "${snapshot.title}" (${snapshot.textLength} characters, ${snapshot.images.length} images)`);
  } catch (err) {
    console.error(err);
    await fs.rm(path.join(outDir, 'snapshots', id), { recursive: true, force: true });
    await writeJson(path.join(outDir, 'errors', `${id}.json`), {
      id,
      url,
      capturedAt,
      httpStatus: err.httpStatus ?? null,
      error: err instanceof CaptureError ? err.message : `Unexpected error: ${err.message}`,
    });
  }
}

async function capture(url, id, capturedAt, snapshotDir) {
  const browser = await launchBrowser();
  try {
    const userAgent = (await browser.newPage().then(async (p) => {
      const ua = await p.evaluate(() => navigator.userAgent);
      await p.close();
      return ua;
    })).replace('HeadlessChrome', 'Chrome');

    const context = await browser.newContext({
      userAgent,
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (err) {
      throw new CaptureError(`The page could not be loaded (${err.message.split('\n')[0]})`);
    }
    const httpStatus = response ? response.status() : null;
    const rawHtml = response ? await response.text().catch(() => '') : '';

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await scrollThroughPage(page);
    await useLoadedImageSources(page);

    const finalUrl = page.url();
    const renderedHtml = await page.content();
    const pageTitle = await page.title();

    if (BLOCKED_TITLES.some((re) => re.test(pageTitle))) {
      throw new CaptureError(`The website showed an anti-bot check ("${pageTitle}") instead of the article.`, httpStatus);
    }

    const meta = readMetadata(renderedHtml, finalUrl);
    const article = pickBestArticle([
      extractArticle(renderedHtml, finalUrl, 'rendered'),
      extractArticle(rawHtml, finalUrl, 'raw'),
    ]);

    if (!article || article.length < MIN_TEXT_LENGTH) {
      const reason = httpStatus && httpStatus >= 400
        ? `The website refused the request (HTTP ${httpStatus}).`
        : 'No article text was found. The site may have blocked the capture, or the article may be behind a hard paywall.';
      throw new CaptureError(reason, httpStatus);
    }

    await fs.mkdir(path.join(snapshotDir, 'images'), { recursive: true });
    const { contentHtml, images } = await saveImages(article.content, finalUrl, context, snapshotDir);

    let leadImage = null;
    if (images.length === 0 && meta.image) {
      const saved = await downloadImage(meta.image, finalUrl, context, snapshotDir, 'lead');
      if (saved) leadImage = saved;
    }

    const snapshot = {
      id,
      url,
      finalUrl,
      capturedAt,
      title: cleanText(article.title) || meta.title || cleanText(pageTitle) || finalUrl,
      byline: cleanText(article.byline) || meta.author || null,
      siteName: cleanText(article.siteName) || meta.siteName || new URL(finalUrl).hostname,
      publishedTime: article.publishedTime || meta.publishedTime || null,
      excerpt: cleanText(article.excerpt) || null,
      lang: article.lang || null,
      httpStatus,
      textLength: article.length,
      extractedFrom: article.source,
      warning: article.length < LOW_TEXT_LENGTH
        ? 'Only a small amount of text was found. The article may be incomplete (for example, cut off by a paywall).'
        : null,
      leadImage,
      images,
      contentHtml,
      toolVersion: TOOL_VERSION,
    };

    await writeJson(path.join(snapshotDir, 'snapshot.json'), snapshot);
    await fs.writeFile(path.join(snapshotDir, 'page.html.gz'), zlib.gzipSync(renderedHtml));
    return snapshot;
  } finally {
    await browser.close();
  }
}

async function launchBrowser() {
  const options = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  };
  if (process.env.CHROME_PATH) {
    return chromium.launch({ ...options, executablePath: process.env.CHROME_PATH });
  }
  return chromium.launch({ ...options, channel: 'chrome' });
}

// Scrolls down the page in steps so that lazy-loaded images start loading.
async function scrollThroughPage(page) {
  try {
    for (let i = 0; i < 20; i++) {
      const atBottom = await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
        return window.scrollY + window.innerHeight >= document.body.scrollHeight - 10;
      });
      await page.waitForTimeout(400);
      if (atBottom) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  } catch {
    // Scrolling is best-effort only.
  }
}

// Replaces each image's src with the image the browser actually loaded, so
// lazy-loading placeholders and responsive <picture> sources are resolved.
async function useLoadedImageSources(page) {
  await page.evaluate(() => {
    for (const img of document.querySelectorAll('img')) {
      if (img.currentSrc && !img.currentSrc.startsWith('data:')) {
        img.setAttribute('src', img.currentSrc);
      }
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.removeAttribute('loading');
    }
    for (const source of document.querySelectorAll('picture source')) source.remove();
  }).catch(() => {});
}

function extractArticle(html, url, source) {
  if (!html) return null;
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document, { charThreshold: 300 }).parse();
    return article ? { ...article, source } : null;
  } catch {
    return null;
  }
}

// Soft paywalls sometimes hide text after the page loads, so we compare the
// rendered page with the original HTML and keep whichever has more text.
function pickBestArticle(candidates) {
  const valid = candidates.filter(Boolean);
  if (valid.length === 0) return null;
  const [rendered, raw] = [valid.find((a) => a.source === 'rendered'), valid.find((a) => a.source === 'raw')];
  if (rendered && raw) return raw.length > rendered.length * 1.2 ? raw : rendered;
  return rendered || raw;
}

function readMetadata(html, url) {
  const doc = new JSDOM(html, { url }).window.document;
  const metaContent = (...selectors) => {
    for (const selector of selectors) {
      const value = doc.querySelector(selector)?.getAttribute('content');
      if (value && value.trim()) return value.trim();
    }
    return null;
  };
  let image = metaContent('meta[property="og:image"]', 'meta[name="twitter:image"]');
  try {
    if (image) image = new URL(image, url).href;
  } catch {
    image = null;
  }
  return {
    title: metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]'),
    siteName: metaContent('meta[property="og:site_name"]'),
    author: metaContent('meta[name="author"]'),
    publishedTime: metaContent('meta[property="article:published_time"]', 'meta[name="date"]'),
    image,
  };
}

// Downloads each image in the article, saves it to images/, and rewrites the
// article HTML to point at the saved copies.
async function saveImages(contentHtml, baseUrl, context, snapshotDir) {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);
  const clean = DOMPurify.sanitize(contentHtml, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'svg', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'class', 'id'],
  });
  const doc = new JSDOM(`<body>${clean}</body>`, { url: baseUrl }).window.document;

  const images = [];
  const savedByUrl = new Map();
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    let absolute = null;
    try {
      absolute = src ? new URL(src, baseUrl).href : null;
    } catch {
      absolute = null;
    }
    if (!absolute || !/^https?:/.test(absolute) || images.length >= MAX_IMAGES) {
      removeImage(img);
      continue;
    }
    let saved = savedByUrl.get(absolute);
    if (!saved) {
      saved = await downloadImage(absolute, baseUrl, context, snapshotDir, String(images.length + 1).padStart(2, '0'));
      if (saved) {
        savedByUrl.set(absolute, saved);
        images.push(saved);
      }
    }
    if (!saved) {
      removeImage(img);
      continue;
    }
    img.setAttribute('src', saved.file);
    img.setAttribute('data-original-src', absolute);
    for (const attr of [...img.getAttributeNames()]) {
      if (!['src', 'alt', 'title', 'width', 'height', 'data-original-src'].includes(attr)) img.removeAttribute(attr);
    }
  }

  for (const a of doc.querySelectorAll('a[href]')) {
    try {
      a.setAttribute('href', new URL(a.getAttribute('href'), baseUrl).href);
    } catch {
      a.removeAttribute('href');
    }
  }

  return { contentHtml: doc.body.innerHTML, images };
}

function removeImage(img) {
  const picture = img.closest('picture');
  (picture || img).remove();
}

async function downloadImage(imageUrl, referer, context, snapshotDir, name) {
  try {
    const response = await context.request.get(imageUrl, {
      headers: { Referer: referer, Accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5' },
      timeout: 30000,
    });
    if (!response.ok()) return null;
    const type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = IMAGE_EXTENSIONS[type];
    if (!ext) return null;
    const body = await response.body();
    if (body.length < 200 || body.length > MAX_IMAGE_BYTES) return null;
    const file = `images/${name}.${ext}`;
    await fs.writeFile(path.join(snapshotDir, file), body);
    return { file, originalUrl: imageUrl, type, bytes: body.length };
  } catch {
    return null;
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

await main();
