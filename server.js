import { createHmac, randomBytes, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeQuestion, buildProfile, buildDecisionRequest, normalizeModelDecision, composeReading,
  buildMatchRequest, normalizeMatchDecision, composeMatch,
  buildDrawRequest, normalizeDrawDecision, composeLot
} from './public/js/engine.js';
import { LOTS, DOMAIN_ORDER } from './public/js/data.js';

/* ------------------------------------------------------------------ */
/* 配置与密钥保险箱                                                   */
/* ------------------------------------------------------------------ */

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const VAULT_PATH = resolve(ROOT, 'vault.json');
const ENV_PATH = resolve(ROOT, '.env');
const DATA_DIR = resolve(ROOT, 'data');
const CACHE_PATH = resolve(DATA_DIR, 'model-cache.json');

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv(ENV_PATH);

const config = {
  port: Number(process.env.PORT || 8787),
  endpoint: process.env.DASHSCOPE_ENDPOINT || 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
  model: process.env.DASHSCOPE_MODEL || 'decision-model-preview',
  rateMax: Number(process.env.RATE_LIMIT_MAX || 40),
  rateWindow: Number(process.env.RATE_LIMIT_WINDOW_MS || 600000),
  globalModelLimit: Number(process.env.GLOBAL_MODEL_LIMIT_PER_HOUR || 300),
  trustProxy: process.env.TRUST_PROXY === '1',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
};

function decryptVault() {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY.trim();
  if (!existsSync(VAULT_PATH)) return '';
  try {
    const vault = JSON.parse(readFileSync(VAULT_PATH, 'utf8'));
    const masterHex = process.env.ORACLE_MASTER_KEY || '';
    const master = Buffer.from(masterHex, 'hex');
    if (master.length !== 32) throw new Error('master key missing or invalid');
    const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(vault.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(vault.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(vault.data, 'base64')), decipher.final()]);
    return plain.toString('utf8').trim();
  } catch (error) {
    console.warn('[vault] 无法解密密钥保险箱，将使用本地玄机引擎。原因：' + error.message);
    return '';
  }
}

const apiKey = decryptVault();
const online = Boolean(apiKey);
const tokenSecret = randomBytes(32);
const TOKEN_TTL = 2 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* 安全与限流                                                         */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();
const sessionBuckets = new Map();
let modelCallsThisHour = 0;
let modelHourStarted = Date.now();
let activeModelCalls = 0;

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(map, key, max, windowMs) {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function cleanupBuckets() {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start > config.rateWindow * 2) rateBuckets.delete(key);
  }
  for (const [key, bucket] of sessionBuckets) {
    if (now - bucket.start > 120000) sessionBuckets.delete(key);
  }
  if (now - modelHourStarted > 3600000) {
    modelHourStarted = now;
    modelCallsThisHour = 0;
  }
}
setInterval(cleanupBuckets, 5 * 60 * 1000).unref();

function issueToken() {
  const ts = Date.now();
  const nonce = randomBytes(8).toString('hex');
  const payload = `${ts}.${nonce}`;
  const sig = createHmac('sha256', tokenSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = createHmac('sha256', tokenSecret).update(`${ts}.${nonce}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= TOKEN_TTL;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (config.allowedOrigins.includes(origin)) return true;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return Boolean(host) && o.host === host;
  } catch {
    return false;
  }
}

function securityHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
}

/* ------------------------------------------------------------------ */
/* HTTP 工具                                                          */
/* ------------------------------------------------------------------ */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Request-ID': randomBytes(6).toString('hex')
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function readJsonBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413, code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve({});
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400, code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function sanitizeReadingInput(body) {
  const question = cleanText(body.question, 300);
  if (question.length < 2) {
    const error = new Error('问题太短，至少写两个字。');
    error.status = 400;
    error.code = 'QUESTION_TOO_SHORT';
    throw error;
  }
  const mode = ['verdict', 'choice', 'score'].includes(body.mode) ? body.mode : 'verdict';
  const options = Array.isArray(body.options)
    ? body.options.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 6)
    : [];
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(body.birth || '')) ? String(body.birth) : '';
  const time = /^\d{1,2}:\d{2}$/.test(String(body.time || '')) ? String(body.time) : '';
  const gender = ['male', 'female', 'other'].includes(body.gender) ? body.gender : '';
  const contextDomain = DOMAIN_ORDER.includes(body.contextDomain) ? body.contextDomain : '';
  const chatContext = Array.isArray(body.chatContext)
    ? body.chatContext.slice(-6).map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(m?.content, 180)
    })).filter((m) => m.content)
    : [];
  return {
    question,
    mode,
    options,
    name: cleanText(body.name, 24),
    birth,
    time,
    gender,
    contextDomain,
    chatContext,
    nonce: cleanText(body.nonce, 40)
  };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    valid: Boolean(profile.valid),
    name: profile.name || '',
    birth: profile.birth || '',
    timeKnown: Boolean(profile.timeKnown),
    zodiac: profile.zodiac || '',
    dayMaster: profile.dayMaster || null,
    elementScores: profile.elementScores,
    elementCounts: profile.elementCounts,
    strongest: profile.strongest,
    weakest: profile.weakest,
    missing: profile.missing,
    favorableElement: profile.favorableElement,
    lucky: profile.lucky || null,
    archetype: profile.archetype || null,
    summary: profile.summary,
    signature: profile.signature,
    pillars: profile.pillars || []
  };
}

/* ------------------------------------------------------------------ */
/* 决策模型调用                                                       */
/* ------------------------------------------------------------------ */

const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;

function loadPersistentCache() {
  if (!existsSync(CACHE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry && typeof entry.expires === 'number' && entry.expires > now && entry.value) {
        cache.set(key, entry);
      }
    }
  } catch (error) {
    console.warn('[cache] 读取持久缓存失败：' + error.message);
  }
}

function persistCache() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const now = Date.now();
    const object = {};
    for (const [key, entry] of cache) {
      if (entry.expires > now) object[key] = entry;
    }
    writeFileSync(CACHE_PATH, JSON.stringify(object), 'utf8');
  } catch (error) {
    console.warn('[cache] 写入持久缓存失败：' + error.message);
  }
}

loadPersistentCache();

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  persistCache();
}

async function callDecision(payload) {
  if (!apiKey) {
    const error = new Error('NO_KEY');
    error.reason = 'no_key';
    throw error;
  }
  if (Date.now() - modelHourStarted > 3600000) {
    modelHourStarted = Date.now();
    modelCallsThisHour = 0;
  }
  if (modelCallsThisHour >= config.globalModelLimit) {
    const error = new Error('GLOBAL_QUOTA');
    error.reason = 'quota';
    throw error;
  }
  if (activeModelCalls >= 4) {
    const error = new Error('BUSY');
    error.reason = 'busy';
    throw error;
  }

  const key = createHash('sha256').update(stableStringify(payload)).digest('hex');
  const cached = cacheGet(key);
  if (cached) return { data: cached, cached: true };

  activeModelCalls += 1;
  modelCallsThisHour += 1;
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const requestId = response.headers.get('x-request-id') || '';
      const error = new Error(`UPSTREAM_${response.status}${requestId ? `_${requestId}` : ''}`);
      error.reason = response.status === 401 || response.status === 403 ? 'auth' : 'error';
      throw error;
    }
    const data = await response.json();
    if (!data?.answers || typeof data.answers !== 'object') {
      const error = new Error('BAD_RESPONSE');
      error.reason = 'error';
      throw error;
    }
    cacheSet(key, data);
    return { data, cached: false };
  } finally {
    activeModelCalls -= 1;
  }
}

function fallbackLabel(reason) {
  const map = {
    no_key: '未配置模型密钥',
    quota: '模型小时配额已用完',
    busy: '模型繁忙',
    auth: '模型鉴权未通过',
    error: '模型暂时不可用',
    timeout: '模型响应超时'
  };
  return map[reason] || '模型暂时不可用';
}

async function decide(payload, local, normalize, pickMap) {
  if (!online) {
    return { decision: local, source: 'local', cached: false, fallbackReason: 'no_key', fallbackText: fallbackLabel('no_key') };
  }
  try {
    const result = await callDecision(payload);
    return {
      decision: normalize(result.data, local, pickMap),
      source: 'model',
      cached: result.cached,
      fallbackReason: null,
      fallbackText: ''
    };
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? 'timeout' : (error.reason || 'error');
    console.warn(`[model] ${reason}: ${error.message}`);
    return {
      decision: local,
      source: 'local',
      cached: false,
      fallbackReason: reason,
      fallbackText: fallbackLabel(reason)
    };
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                               */
/* ------------------------------------------------------------------ */

async function handleSession(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(sessionBuckets, ip, 120, 60000)) {
    return sendError(res, 429, 'RATE_LIMITED', '请求太频繁，先歇一秒。');
  }
  return sendJson(res, 200, {
    ok: true,
    token: issueToken(),
    expiresIn: TOKEN_TTL,
    online,
    model: online ? config.model : null,
    engine: 'local-oracle-v1'
  });
}

async function handleDivine(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(rateBuckets, ip, config.rateMax, config.rateWindow)) {
    return sendError(res, 429, 'RATE_LIMITED', '香火太旺，先歇一会儿再来。');
  }
  const body = await readJsonBody(req);
  const input = sanitizeReadingInput(body);
  const preAnalysis = analyzeQuestion(input.question, input.options);
  if (input.mode === 'verdict' && preAnalysis.kind === 'choice' && preAnalysis.choices.length >= 2) {
    input.mode = 'choice';
    input.options = preAnalysis.choices;
  }
  const profile = buildProfile(input);
  const { payload, local, analysis, pickMap } = buildDecisionRequest(input, profile);
  const result = await decide(payload, local, (data, fallback) => normalizeModelDecision(data, fallback, pickMap));
  const reading = composeReading(input, profile, result.decision);
  reading.meta.cached = result.cached;
  reading.meta.fallbackReason = result.fallbackReason;
  reading.meta.fallbackText = result.fallbackText;

  return sendJson(res, 200, {
    ok: true,
    reading,
    profile: publicProfile(profile),
    analysis: { domain: analysis.domain, domainLabel: analysis.domainLabel, kind: analysis.kind, choices: analysis.choices },
    meta: {
      source: result.source,
      online,
      cached: result.cached,
      fallbackReason: result.fallbackReason,
      fallbackText: result.fallbackText
    }
  });
}

async function handleMatch(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(rateBuckets, ip, config.rateMax, config.rateWindow)) {
    return sendError(res, 429, 'RATE_LIMITED', '香火太旺，先歇一会儿再来。');
  }
  const body = await readJsonBody(req);
  const personA = buildProfile({
    name: cleanText(body.aName, 24),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(String(body.aBirth || '')) ? String(body.aBirth) : '',
    time: /^\d{1,2}:\d{2}$/.test(String(body.aTime || '')) ? String(body.aTime) : '',
    gender: ''
  });
  const personB = buildProfile({
    name: cleanText(body.bName, 24),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(String(body.bBirth || '')) ? String(body.bBirth) : '',
    time: /^\d{1,2}:\d{2}$/.test(String(body.bTime || '')) ? String(body.bTime) : '',
    gender: ''
  });
  if (!personA.name || !personB.name) {
    return sendError(res, 400, 'NAME_REQUIRED', '两个人的名字都要写。');
  }
  const { payload, local } = buildMatchRequest(personA, personB);
  const result = await decide(payload, local, (data, fallback) => normalizeMatchDecision(data, fallback));
  const reading = composeMatch(personA, personB, result.decision);
  reading.meta.cached = result.cached;
  reading.meta.fallbackReason = result.fallbackReason;
  reading.meta.fallbackText = result.fallbackText;

  return sendJson(res, 200, {
    ok: true,
    reading,
    personA: publicProfile(personA),
    personB: publicProfile(personB),
    meta: {
      source: result.source,
      online,
      cached: result.cached,
      fallbackReason: result.fallbackReason,
      fallbackText: result.fallbackText
    }
  });
}

async function handleDraw(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(rateBuckets, ip, config.rateMax, config.rateWindow)) {
    return sendError(res, 429, 'RATE_LIMITED', '香火太旺，先歇一会儿再来。');
  }
  const body = await readJsonBody(req);
  const question = cleanText(body.question, 300) || '我近期的整体运势如何？';
  const input = {
    question,
    name: cleanText(body.name, 24),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(String(body.birth || '')) ? String(body.birth) : '',
    time: '',
    gender: '',
    nonce: cleanText(body.nonce, 40)
  };
  const profile = buildProfile(input);
  const { payload, local } = buildDrawRequest(input, profile);
  const result = await decide(payload, local, (data, fallback) => normalizeDrawDecision(data, fallback));
  const lot = LOTS.find((x) => x.id === result.decision.lotId) || LOTS[0];
  const reading = composeLot(lot, input, profile, result.decision);
  reading.meta.cached = result.cached;
  reading.meta.fallbackReason = result.fallbackReason;
  reading.meta.fallbackText = result.fallbackText;

  return sendJson(res, 200, {
    ok: true,
    reading,
    profile: publicProfile(profile),
    meta: {
      source: result.source,
      online,
      cached: result.cached,
      fallbackReason: result.fallbackReason,
      fallbackText: result.fallbackText
    }
  });
}

/* ------------------------------------------------------------------ */
/* 静态文件                                                           */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendError(res, 400, 'BAD_PATH', '路径不合法。');
  }
  const rel = decoded === '/' ? '/index.html' : decoded;
  const target = normalize(join(PUBLIC_DIR, rel));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    return sendError(res, 403, 'FORBIDDEN', '没有权限。');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return sendError(res, 404, 'NOT_FOUND', '这里没有东西。');
  }
  const ext = extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = statSync(target);
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  });
  createReadStream(target).pipe(res);
}

/* ------------------------------------------------------------------ */
/* 服务器                                                             */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!sameOrigin(req)) {
    return sendError(res, 403, 'ORIGIN_FORBIDDEN', '来源不被允许。');
  }

  try {
    if (req.method === 'GET' && pathname === '/api/session') {
      return await handleSession(req, res);
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        online,
        model: online ? config.model : null,
        engine: 'local-oracle-v1',
        uptime: Math.round(process.uptime())
      });
    }

    if (pathname.startsWith('/api/')) {
      if (req.method !== 'POST') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只接受 POST。');
      }
      if (!verifyToken(req.headers['x-oracle-token'])) {
        return sendError(res, 401, 'TOKEN_INVALID', '天机令牌失效，刷新页面再试。');
      }
      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        return sendError(res, 415, 'CONTENT_TYPE', '请求必须是 JSON。');
      }

      if (pathname === '/api/divine') return await handleDivine(req, res);
      if (pathname === '/api/match') return await handleMatch(req, res);
      if (pathname === '/api/draw') return await handleDraw(req, res);
      return sendError(res, 404, 'NOT_FOUND', '没有这个接口。');
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持这个方法。');
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.code || 'BAD_REQUEST', error.message);
    }
    console.error('[server]', error);
    return sendError(res, 500, 'INTERNAL', '天机紊乱了一下，再试一次。');
  } finally {
    const ms = Date.now() - started;
    if (pathname.startsWith('/api/')) {
      console.log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${ms}ms`);
    }
  }
});

server.listen(config.port, () => {
  console.log('');
  console.log('  天机判官 · GUNCAT ORACLE');
  console.log(`  http://localhost:${config.port}`);
  console.log(`  决策模型：${online ? '已连线' : '未配置（使用本地玄机引擎）'}`);
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n判官收笔。');
  server.close(() => process.exit(0));
});
