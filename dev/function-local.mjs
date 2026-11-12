// 本地验证入口（不进发布包）：Node 直接跑真实 routes.mjs，数据库用内存假表。
// 密钥只从本机 .env 读取，用于本地实测；云端走 Sites Secret。
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { application } from '../functions/routes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const table = new Map();
const fakeDb = {
  from() {
    return {
      select() {
        return {
          eq(_col, val) {
            return {
              limit: async () => {
                const row = table.get(val);
                return { data: row ? [{ value: row.value, expires: row.expires }] : [], error: null };
              }
            };
          }
        };
      },
      upsert: async (row) => {
        table.set(row.key, row);
        return { error: null };
      },
      delete() {
        return { lt: async () => ({ error: null }) };
      }
    };
  }
};

const handle = application({ db: fakeDb });

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:8000');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, String(value));
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  });
  let response;
  try {
    response = await handle({ request, requestId: 'local' });
  } catch (error) {
    console.error('[local]', error);
    response = Response.json({ ok: false, error: { code: 'INTERNAL', message: '本地验证入口异常。' } }, { status: 500 });
  }
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(8000, '127.0.0.1', () => {
  console.log('function local adapter: http://127.0.0.1:8000/functions/v1/app/health');
});