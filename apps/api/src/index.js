import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.API_PORT || 4000;
const HOST = process.env.API_HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL;
const OUTPUT_DIR = process.env.STATIC_OUTPUT_DIR || '/app/output';
const PUBLIC_BASE = process.env.PUBLIC_OUTPUT_BASE_URL || `http://localhost:${PORT}/output`;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Queue (optional) - only initialize when REDIS_URL is provided
let renderQueue = null;
console.log('API REDIS_URL:', REDIS_URL);
if (REDIS_URL) {
  try {
    // parse URL to avoid client using default localhost in some environments
    const u = new URL(REDIS_URL);
    const conn = { host: u.hostname, port: Number(u.port || 6379) };
    if (u.password) conn.password = u.password;
    renderQueue = new Queue('render', { connection: conn });
    console.log('Render queue created, connecting to', conn.host + ':' + conn.port);
  } catch (err) {
    console.error('Failed to create render queue', err);
    renderQueue = null;
  }
} else {
  console.warn('REDIS_URL not set; worker queue disabled');
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// Serve generated files
app.use('/output', express.static(OUTPUT_DIR));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Create Job
app.post('/jobs', async (req, res) => {
  try {
    const { headline, backgroundUrl, newsImageUrl, templateName = 'default' } = req.body || {};
    if (!headline) return res.status(400).json({ error: 'headline is required' });

    const job = await prisma.job.create({
      data: { headline, backgroundUrl, newsImageUrl, templateName, status: 'PENDING' }
    });

    // enqueue with data (if queue available)
    if (renderQueue) {
      try {
        await renderQueue.add("render", {
          id: job.id,
          headline,
          backgroundUrl,
          newsImageUrl
        });
      } catch (qerr) {
        console.error('Failed to enqueue job to renderQueue', qerr);
      }
    } else {
      console.warn('Render queue not available; job created but not enqueued');
    }

    res.status(201).json(job);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create job' });
  }
});

// List Jobs
app.get('/jobs', async (_req, res) => {
  try {
    const jobs = await prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(jobs);
  } catch (err) {
    console.error('Failed to list jobs', err);
    res.status(500).json({ error: 'failed to list jobs' });
  }
});

// Get Job
app.get('/jobs/:id', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json(job);
  } catch (err) {
    console.error('Failed to get job', err);
    res.status(500).json({ error: 'failed to get job' });
  }
});

// Update Job (worker will call this)
app.put('/jobs/:id', async (req, res) => {
  const { status, outputFileName } = req.body || {};
  try {
    const data = {};
    if (status) data.status = status;
    if (outputFileName) data.outputUrl = `${PUBLIC_BASE}/${outputFileName}`;
    const up = await prisma.job.update({ where: { id: req.params.id }, data });
    res.json(up);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to update job' });
  }
});

app.listen(PORT, HOST, async () => {
  // run prisma migrate (deploy) once on boot (simple way for dev)
  try {
    // eslint-disable-next-line no-undef
    const { execaSync } = await import('execa');
  } catch {
    // ignore (not needed here)
  }
  console.log(`API running on http://${HOST}:${PORT}`);
});

// Graceful logging for unexpected errors in development so the container doesn't immediately exit
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection at:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});
