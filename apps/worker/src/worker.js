import 'dotenv/config';
import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import fetch from 'node-fetch';
import { URL, fileURLToPath } from 'node:url';

const REDIS_URL = process.env.REDIS_URL;
const OUTPUT_DIR = process.env.STATIC_OUTPUT_DIR || '/app/output';
const API_BASE = process.env.API_INTERNAL_URL || 'http://api:4000';
const WIDTH = parseInt(process.env.RENDER_WIDTH || '1080', 10);
const HEIGHT = parseInt(process.env.RENDER_HEIGHT || '1080', 10);

// ESM: derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const LOGO_FILENAME = process.env.WORKER_LOGO_FILENAME || 'logo.png';

const templateHTML = ({ headline, backgroundUrl, newsImageUrl, logoPath, logoIsSvg, logoSize = 84, logoPad = 12 }) => `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  :root{ --logo-size: ${logoSize}px; --logo-pad: ${logoPad}px }
  @font-face { font-family: sans; src: local("Arial"); }
  body{
    margin:0; width:${WIDTH}px; height:${HEIGHT}px; 
    font-family:sans; color:#fff;
    /* fallback background color while a background image loads */
    background:#d1d5db; /* light gray */
    position:relative; overflow:hidden; display:block;
  }
  /* subtle vignette + texture */
  .overlay{position:absolute; inset:0; background:linear-gradient(rgba(0,0,0,0.18), rgba(0,0,0,0.25)); mix-blend-mode:multiply}
  /* glassy date badge */
  .date{position:absolute; top:24px; right:24px; padding:8px 12px; border-radius:12px; font-weight:700; color:#fff; background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)); backdrop-filter: blur(6px); border:1px solid rgba(255,255,255,0.06); box-shadow: 0 6px 18px rgba(0,0,0,0.25)}
  /* logo container: square with equal padding around the logo image */
  .logo{position:absolute; top:24px; left:24px; display:flex; align-items:center; justify-content:center; border-radius:14px; gap:0; padding:var(--logo-pad); width:calc(var(--logo-size) + (var(--logo-pad) * 2)); height:calc(var(--logo-size) + (var(--logo-pad) * 2));}
  /* raster logos get a white pill for contrast, SVG logos often contain their own color/white fill so give them a dark pill */
  /* adjust pill color for raster vs svg */
  .logo { background: rgba(255,255,255,0.96); }
  .logo.logo-svg { background: rgba(0,0,0,0.6); }
  .logo-img{width:var(--logo-size); height:var(--logo-size); object-fit:contain; display:block}
  .logo .logo-img{background:transparent; border-radius:8px; border:1px solid rgba(0,0,0,0.06)}
  .headline{
    position:absolute; left:40px; right:40px; bottom:120px;
    font-size:56px; line-height:1.2; text-shadow:0 6px 18px rgba(0,0,0,.7);
    text-align:center;
  }
  /* card behind the news image to create depth (like the screenshot) */
  .card{
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:300px; width:620px; height:620px; display:flex; align-items:center; justify-content:center;
    border-radius:36px; background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    box-shadow: 0 30px 80px rgba(0,0,0,0.45); backdrop-filter: blur(12px); border:1px solid rgba(255,255,255,0.04);
  }
  .newsimg{
    display:block; width:540px; height:540px; object-fit:cover; border-radius:24px; box-shadow:0 10px 30px rgba(0,0,0,.5)
  }
  /* background image element (we use an <img> so Playwright can wait for it to load) */
  .bgimg{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:-3}
  /* subtle vignette to integrate bg with glass card */
  .bg-vignette{position:absolute; inset:0; background: radial-gradient(closest-side at 50% 40%, rgba(0,0,0,0.14), rgba(0,0,0,0.28)); z-index:-1}
  /* glassy CTA */
  .cta{
    position:absolute; left:50%; transform:translateX(-50%); bottom:40px;
    padding:12px 18px; border-radius:12px; font-weight:800; color:#fff;
    background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  }
</style>
</head>
<body>
  <div class="overlay"></div>
  <div class="logo ${logoIsSvg ? 'logo-svg' : ''}">${logoPath ? `<img class="logo-img" src="${logoPath}" alt="Dhaka Heralds"/>` : '<span>Dhaka Heralds</span>'}</div>
  ${backgroundUrl ? `<img class="bgimg" src="${backgroundUrl}" alt="background"/>` : ''}
  <div class="bg-vignette"></div>
  <div class="date">${new Date().toLocaleDateString('bn-BD',{weekday:'short', year:'numeric',month:'short',day:'numeric'})}</div>
  ${newsImageUrl ? `<div class="card"><img class="newsimg" src="${newsImageUrl}"/></div>` : ''}
  <div class="headline">${headline ?? ''}</div>
  <div class="cta">Read More</div>
</body>
</html>
`;

async function renderToFile({ id, headline, backgroundUrl, newsImageUrl }) {
  const fileName = `${id}.png`;
  const outPath = path.join(OUTPUT_DIR, fileName);

  // Normalize common share links to direct image URLs so the browser can load the image
  function normalizeImageUrl(u) {
    if (!u) return u;
    try {
      // Google Drive shared links -> direct view URL
      if (u.includes('drive.google.com')) {
        // try to extract /d/<id>
        const m = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const idFromPath = m && m[1];
        const urlObj = new URL(u);
        const idFromQuery = urlObj.searchParams.get('id');
        const fileId = idFromPath || idFromQuery;
        if (fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }

      // Dropbox shared links -> raw content
      if (u.includes('dropbox.com')) {
        // replace ?dl=0 with raw=1 or dl=1
        if (u.includes('?')) return u.replace(/\?dl=0/, '?raw=1').replace(/\?dl=1/, '?raw=1');
        return u + '?raw=1';
      }

      return u;
    } catch (e) {
      return u;
    }
  }

  backgroundUrl = normalizeImageUrl(backgroundUrl);
  newsImageUrl = normalizeImageUrl(newsImageUrl);

  // If a URL points to Google Drive, fetch it via the API proxy and save locally so Playwright can load raw bytes
  async function fetchDriveViaApiIfNeeded(u, role = 'news') {
    if (!u) return u;
    try {
      const parsed = new URL(u);
      if (!parsed.hostname.includes('drive.google.com')) return u;

      // derive a safe filename
      const fileIdMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = fileIdMatch ? fileIdMatch[1] : parsed.searchParams.get('id') || String(Date.now());
      // try to keep extension if present
      const extFromPath = path.extname(parsed.pathname) || '.jpg';
      const localName = `${id}-${role}-${fileId}${extFromPath}`;
      const localPath = path.join(OUTPUT_DIR, localName);

  // If file already exists, reuse (expose via API output URL)
  if (fs.existsSync(localPath)) return `${API_BASE.replace(/\/$/, '')}/output/${encodeURIComponent(path.basename(localPath))}`;

      const proxyUrl = `${API_BASE.replace(/\/$/, '')}/download?drive=1&filename=${encodeURIComponent(localName)}&url=${encodeURIComponent(u)}`;
      const r = await fetch(proxyUrl);
      if (!r.ok) {
        console.warn('Drive proxy failed for', u, 'status', r.status);
        return u; // fall back to original URL (may be preview HTML)
      }

      // stream to local file
      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(localPath);
        r.body.pipe(dest);
        r.body.on('error', (err) => {
          dest.close();
          reject(err);
        });
        dest.on('finish', resolve);
        dest.on('error', (err) => {
          reject(err);
        });
      });

  // expose via API output URL so Playwright loads over HTTP (more reliable than file://)
  return `${API_BASE.replace(/\/$/, '')}/output/${encodeURIComponent(path.basename(localPath))}`;
    } catch (e) {
      console.error('fetchDriveViaApiIfNeeded error', e?.message || e);
      return u;
    }
  }

  // Prefetch any remote http(s) image into a local file and return file:// path.
  // This helps with hosts that are slow or that send preview HTML; fetching server-side is more reliable.
  async function prefetchRemoteImage(u, role = 'news') {
    if (!u) return u;
    try {
      // already a local file
      if (u.startsWith('file://')) return u;
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return u;

      // create a stable filename based on URL hash
      const hash = crypto.createHash('md5').update(u).digest('hex');
      const extFromPath = path.extname(parsed.pathname).split('?')[0] || '';
      // we'll try to keep a sane extension; if none, we'll infer from content-type after fetching
      let ext = extFromPath || '';
      const localName = `${id}-${role}-${hash}${ext}`;
      const localPath = path.join(OUTPUT_DIR, localName);
  if (fs.existsSync(localPath)) return `${API_BASE.replace(/\/$/, '')}/output/${encodeURIComponent(path.basename(localPath))}`;

      const r = await fetch(u);
      if (!r.ok) {
        console.warn('prefetch failed for', u, 'status', r.status);
        return u;
      }

      // if we didn't have an extension, try to derive from content-type
      if (!ext) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('image/jpeg')) ext = '.jpg';
        else if (ct.includes('image/png')) ext = '.png';
        else if (ct.includes('image/webp')) ext = '.webp';
        else if (ct.includes('svg')) ext = '.svg';
        else ext = '.jpg';
      }

      // if extFromPath was empty, rename localPath to include ext
      const finalLocalName = `${id}-${role}-${hash}${ext}`;
      const finalLocalPath = path.join(OUTPUT_DIR, finalLocalName);

      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(finalLocalPath);
        r.body.pipe(dest);
        r.body.on('error', (err) => { dest.close(); reject(err); });
        dest.on('finish', resolve);
        dest.on('error', reject);
      });

      console.log('Prefetched', u, '->', finalLocalPath);
      return `${API_BASE.replace(/\/$/, '')}/output/${encodeURIComponent(path.basename(finalLocalPath))}`;
    } catch (e) {
      console.warn('prefetch error', e?.message || e);
      return u;
    }
  }

  // attempt to fetch Drive files via API proxy before rendering
  try {
    if (newsImageUrl && newsImageUrl.includes('drive.google.com')) {
      newsImageUrl = await fetchDriveViaApiIfNeeded(newsImageUrl, 'news');
    }
    if (backgroundUrl && backgroundUrl.includes('drive.google.com')) {
      backgroundUrl = await fetchDriveViaApiIfNeeded(backgroundUrl, 'bg');
    }

    // Prefetch remote images to local files (this helps with Cloudinary and other hosts)
    try {
      if (newsImageUrl) newsImageUrl = await prefetchRemoteImage(newsImageUrl, 'news');
    } catch (e) {
      console.warn('prefetch news failed', e?.message || e);
    }
    try {
      if (backgroundUrl) backgroundUrl = await prefetchRemoteImage(backgroundUrl, 'bg');
    } catch (e) {
      console.warn('prefetch bg failed', e?.message || e);
    }
  } catch (e) {
    console.warn('Drive proxy fetch failed, proceeding with original URLs', e?.message || e);
  }

  // resolve logo path (check assets directory inside container)
  let logoPath = null;
  try {
    const assetsDirs = [
      path.join(process.cwd(), 'assets'),
      path.join('/', 'app', 'assets'),
      path.join(__dirname, '..', 'assets'),
    ];

    // If a filename was provided via env, check it first
    const envName = process.env.WORKER_LOGO_FILENAME || LOGO_FILENAME;
    for (const d of assetsDirs) {
      try {
        const candidate = path.join(d, envName);
        if (fs.existsSync(candidate)) {
          logoPath = `file://${candidate}`;
          break;
        }
      } catch { /* ignore */ }
    }

    // If not found, auto-detect the first image file in assets directories
    if (!logoPath) {
      const imageRe = /\.(png|jpe?g|svg|webp)$/i;
      for (const d of assetsDirs) {
        try {
          if (!fs.existsSync(d)) continue;
          const files = fs.readdirSync(d);
          const found = files.find((f) => imageRe.test(f));
          if (found) {
            logoPath = `file://${path.join(d, found)}`;
            break;
          }
        } catch (e) {
          // ignore and continue
        }
      }
    }
  } catch (e) {
    console.warn('logo detect error', e?.message || e);
  }

  // debug: log the resolved logoPath so we can verify the worker found the file
  try {
    console.log('Resolved logoPath:', logoPath);
  } catch (e) {
    /* ignore */
  }

  // simple boolean for template styling (SVG logos may need different pill background)
  const logoIsSvg = !!(logoPath && logoPath.toLowerCase().endsWith('.svg'));

  // If logoPath is a local file:// path or an absolute path, inline as data URI for reliability
  try {
    if (logoPath && logoPath.startsWith('file://')) {
      const lp = logoPath.replace('file://', '');
      if (fs.existsSync(lp)) {
        const buf = fs.readFileSync(lp);
        const ext = path.extname(lp).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        const data = `data:${mime};base64,${buf.toString('base64')}`;
        logoPath = data;
      }
    }
  } catch (e) {
    console.warn('inline logo failed', e?.message || e);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  // increase timeouts and avoid waiting for full network idle (some hosts keep connections open)
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);
  try {
    await page.setContent(templateHTML({ headline, backgroundUrl, newsImageUrl, logoPath, logoIsSvg }), { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.warn('page.setContent warning, continuing rendering despite error:', e?.message || e);
  }
  // If there's a news image, wait for it to be visible and fully loaded to ensure it's captured
  if (newsImageUrl) {
    try {
      await page.waitForSelector('img.newsimg', { state: 'visible', timeout: 12000 });
      // ensure the image has a non-zero naturalWidth (loaded)
      await page.waitForFunction(() => {
        const img = document.querySelector('img.newsimg');
        return img && img.naturalWidth > 10;
      }, { timeout: 12000 });
    } catch (e) {
      // fall back, continue to screenshot even if image didn't fully load
      console.warn('news image did not finish loading in time', e?.message || e);
    }
  }
  // If there's a background image element, wait for it to load too
  if (backgroundUrl) {
    try {
      await page.waitForSelector('img.bgimg', { state: 'visible', timeout: 12000 });
      await page.waitForFunction(() => {
        const img = document.querySelector('img.bgimg');
        return img && img.naturalWidth > 10;
      }, { timeout: 12000 });
    } catch (e) {
      console.warn('background image did not finish loading in time', e?.message || e);
    }
  }
  await page.waitForTimeout(300); // small settle
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  return fileName;
}

// const worker = new Worker('render', async (job) => {
//   const data = job.data;
//   try {
//     // mark processing
//     await fetch(`${API_BASE}/jobs/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PROCESSING' })});
//     const fileName = await renderToFile(data);
//     // mark done
//     await fetch(`${API_BASE}/jobs/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DONE', outputFileName: fileName })});
//   } catch (e) {
//     console.error('render error', e);
//     await fetch(`${API_BASE}/jobs/${data.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ERROR' })});
//   }
// }, { connection: { url: REDIS_URL }});

// console.log('Worker listening for jobs...');

// const worker = new Worker("render", async (job) => {
//   console.log("Processing job", job.id);
//   // image generate...
// }, {
//   connection: { url: process.env.REDIS_URL }
// });

// worker.on("completed", job => {
//   console.log(`✅ Job ${job.id} completed`);
// });

// worker.on("failed", (job, err) => {
//   console.error(`❌ Job ${job?.id} failed:`, err);
// });

function makeConnectionOptionsFromUrl(url) {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const conn = { host: u.hostname, port: Number(u.port || 6379) };
    if (u.password) conn.password = u.password;
    return conn;
  } catch (e) {
    console.error('Invalid REDIS_URL', e);
    return undefined;
  }
}

const connectionOptions = makeConnectionOptionsFromUrl(REDIS_URL);

async function createWorkerWithRetry(retries = 6, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const worker = new Worker(
        'render',
        async (job) => {
          console.log('🧾 Received job:', job.id);
          const data = job.data;
          try {
            await fetch(`${API_BASE}/jobs/${data.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'PROCESSING' }),
            });
            const fileName = await renderToFile(data);
            await fetch(`${API_BASE}/jobs/${data.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'DONE', outputFileName: fileName }),
            });
            console.log(`✅ Job ${job.id} done`);
          } catch (e) {
            console.error('❌ Render error:', e);
            try {
              await fetch(`${API_BASE}/jobs/${data.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'ERROR' }),
              });
            } catch (e2) {
              console.error('Failed to report job error to API', e2);
            }
          }
        },
        {
          connection: connectionOptions ? { ...connectionOptions } : undefined,
          concurrency: 1,
        }
      );

      worker.on('ready', () => console.log('🟢 Worker ready and waiting for jobs...'));
      worker.on('completed', (job) => console.log(`🎯 Job ${job.id} completed`));
      worker.on('failed', (job, err) => console.error(`💥 Job ${job?.id} failed: ${err?.message}`));

      return worker;
    } catch (err) {
      console.error(`Failed to create worker (attempt ${i + 1}/${retries}):`, err?.message || err);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Could not create worker after retries');
}

(async () => {
  try {
    console.log('Worker REDIS_URL:', REDIS_URL, 'connectionOptions:', connectionOptions);
    await createWorkerWithRetry();
    console.log('Worker listening for jobs...');
  } catch (e) {
    console.error('Worker failed to start:', e);
    process.exit(1);
  }
})();
