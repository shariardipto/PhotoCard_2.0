import 'dotenv/config';
import { Worker } from 'bullmq';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const REDIS_URL = process.env.REDIS_URL;
const OUTPUT_DIR = process.env.STATIC_OUTPUT_DIR || '/app/output';
const API_BASE = process.env.API_INTERNAL_URL || 'http://api:4000';
const WIDTH = parseInt(process.env.RENDER_WIDTH || '1080', 10);
const HEIGHT = parseInt(process.env.RENDER_HEIGHT || '1080', 10);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const templateHTML = ({ headline, backgroundUrl, newsImageUrl }) => `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @font-face { font-family: sans; src: local("Arial"); }
  body{
    margin:0; width:${WIDTH}px; height:${HEIGHT}px; 
    font-family:sans; color:#fff;
    background:${backgroundUrl ? `url('${backgroundUrl}')` : '#b91c1c'} center/cover no-repeat;
    position:relative; overflow:hidden;
  }
  .overlay{position:absolute; inset:0; background:rgba(0,0,0,.35)}
  .date{position:absolute; top:24px; right:24px; background:rgba(0,0,0,.55); padding:8px 12px; border-radius:8px; font-weight:700}
  .logo{position:absolute; top:24px; left:24px; font-weight:900; background:rgba(0,0,0,.55); padding:8px 12px; border-radius:8px}
  .headline{
    position:absolute; left:40px; right:40px; bottom:120px;
    font-size:56px; line-height:1.2; text-shadow:0 6px 18px rgba(0,0,0,.7);
    text-align:center;
  }
  .newsimg{
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:320px; width:540px; height:540px; object-fit:cover; border-radius:24px; box-shadow:0 10px 30px rgba(0,0,0,.5)
  }
  .cta{
    position:absolute; left:50%; transform:translateX(-50%); bottom:40px;
    background:#ef4444; padding:12px 18px; border-radius:12px; font-weight:800;
  }
</style>
</head>
<body>
  <div class="overlay"></div>
  <div class="logo">Dhaka Heralds</div>
  <div class="date">${new Date().toLocaleDateString('bn-BD',{year:'numeric',month:'short',day:'numeric'})}</div>
  ${newsImageUrl ? `<img class="newsimg" src="${newsImageUrl}"/>` : ''}
  <div class="headline">${headline ?? ''}</div>
  <div class="cta">Read More</div>
</body>
</html>
`;

async function renderToFile({ id, headline, backgroundUrl, newsImageUrl }) {
  const fileName = `${id}.png`;
  const outPath = path.join(OUTPUT_DIR, fileName);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(templateHTML({ headline, backgroundUrl, newsImageUrl }), { waitUntil: 'networkidle' });
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
