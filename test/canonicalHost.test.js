import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server', 'index.js');
const PORT = 3998;

/**
 * CANONICAL_HOST modül yüklenirken bir kez okunuyor; ana test sürecini
 * etkilememesi için sunucuyu ayrı bir alt süreçte, kendi ortam
 * değişkenleriyle başlatıyoruz.
 */
function startServer(env) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(PORT), LEADERBOARD_DB: ':memory:', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sunucu 5 saniyede başlamadı')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('http://localhost')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', reject);
  });

  return { child, ready };
}

function get(hostHeader, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, headers: { Host: hostHeader } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('CANONICAL_HOST ayarlıyken başka bir Host başlığı 301 ile kanonik adrese yönlenir', async () => {
  const { child, ready } = startServer({ CANONICAL_HOST: 'oyunteorisionline.com' });
  try {
    await ready;
    const res = await get('oyunteorisi.fly.dev', '/healthz');
    assert.equal(res.status, 301);
    assert.equal(res.location, 'https://oyunteorisionline.com/healthz');
  } finally {
    child.kill();
  }
});

test('CANONICAL_HOST ayarlıyken kanonik adresin kendisi yönlenmeden yanıt verir', async () => {
  const { child, ready } = startServer({ CANONICAL_HOST: 'oyunteorisionline.com' });
  try {
    await ready;
    const res = await get('oyunteorisionline.com', '/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.location, undefined);
  } finally {
    child.kill();
  }
});

test('CANONICAL_HOST ayarlı değilken hiçbir yönlendirme yapılmaz', async () => {
  const { child, ready } = startServer({});
  try {
    await ready;
    const res = await get('anything.example.com', '/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.location, undefined);
  } finally {
    child.kill();
  }
});
