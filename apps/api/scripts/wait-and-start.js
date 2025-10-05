#!/usr/bin/env node
import 'dotenv/config';
import { setTimeout } from 'timers/promises';
import { execa } from 'execa';

const MAX_RETRIES = Number(process.env.DB_WAIT_RETRIES || 15);
const RETRY_DELAY = Number(process.env.DB_WAIT_DELAY_MS || 2000);
const DB_HOST = process.env.DB_HOST || 'db';
const DB_PORT = Number(process.env.DB_PORT || 5432);

async function canConnect() {
  try {
    // simple TCP check using net module
    const net = await import('net');
    return await new Promise((resolve) => {
      const s = net.createConnection({ host: DB_HOST, port: DB_PORT }, () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
  } catch (e) {
    return false;
  }
}

(async () => {
  console.log(`Waiting for database ${DB_HOST}:${DB_PORT}...`);
  let ok = false;
  for (let i = 0; i < MAX_RETRIES; i++) {
    ok = await canConnect();
    if (ok) break;
    console.log(`DB not ready, retrying in ${RETRY_DELAY}ms (${i + 1}/${MAX_RETRIES})`);
    await setTimeout(RETRY_DELAY);
  }

  if (!ok) {
    console.error('Database did not become available in time, continuing anyway. Prisma may fail.');
  } else {
    console.log('Database is reachable, running migrations...');
    try {
      // generate client then run migrations, with retries for transient network failures
      const GEN_RETRIES = 3;
      let genOk = false;
      for (let g = 0; g < GEN_RETRIES; g++) {
        try {
          await execa('npm', ['run', 'prisma:generate'], { stdio: 'inherit' });
          genOk = true;
          break;
        } catch (ge) {
          console.error('prisma generate attempt', g + 1, 'failed', ge?.message?.slice?.(0, 200));
          await setTimeout(2000);
        }
      }
      if (!genOk) console.error('prisma generate failed after retries');
      await execa('npm', ['run', 'prisma:migrate'], { stdio: 'inherit' });
    } catch (e) {
      console.error('prisma migrate failed', e);
    }
  }

  console.log('Starting API server');
  await execa('node', ['src/index.js'], { stdio: 'inherit' });
})();
