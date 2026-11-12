import {
  analyzeQuestion, buildProfile, buildDecisionRequest, normalizeModelDecision, composeReading,
  buildMatchRequest, normalizeMatchDecision, composeMatch,
  buildDrawRequest, normalizeDrawDecision, composeLot
} from './engine.js';
import { LOTS, DOMAIN_ORDER } from './data.js';
import { VAULT } from './vault.mjs';

const CONFIG = {
  endpoint: 'https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
  model: 'decision-model-preview',
  rateMax: 40,
  rateWindow: 600000,
  globalModelLimit: 300
};
const TOKEN_TTL = 2 * 60 * 60 * 1000;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const STARTED = Date.now();

const enc = new TextEncoder();
const envGet = (name) => (typeof Deno !== 'undefined' ? Deno.env.get(name) : process.env[name]);
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64url = (buf) => bytesToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* 密钥保险箱（WebCrypto 版 AES-256-GCM）                               */
/* ------------------------------------------------------------------ */

let apiKeyPromise = null;
function getApiKey() {
  if (!apiKeyPromise) {
    apiKeyPromise = (async () => {
      const direct = envGet('DASHSCOPE_API_KEY');
      if (direct) return direct.trim();
      const masterHex = String(envGet('ORACLE_MASTER_KEY') || '').trim();
      if (!/^[0-9a-f]{64}$/i.test(masterHex)) return '';
      try {
        const key = await crypto.subtle.importKey('raw', hexToBytes(masterHex), 'AES-GCM', false, ['decrypt']);
        const data = b64ToBytes(VAULT.data);
        const tag = b64ToBytes(VAULT.tag);
        const combined = new Uint8Array(data.length + tag.length);
        combined.set(data);
        combined.set(tag, data.length);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBytes(VAULT.iv), tagLength: 128 },
          key,
          combined
        );
        return new TextDecoder().decode(plain).trim();
      } catch {
        return '';
      }
    })();
  }
  return apiKeyPromise;
}

// 会话签名密钥由主密码派生：边缘运行时多 isolate 之间令牌依然互认。
let tokenKeyPromise = null;
function getTokenKey() {
  if (!tokenKeyPromise) {
    tokenKeyPromise = (async () => {
      const material = String(envGet('ORACLE_MASTER_KEY') || '') || VAULT.data;
      const secret = await sha256(enc.encode(`oracle-session:${material}`));
      return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
  }
  return tokenKeyPromise;
}

async function issueToken() {
  const ts = Date.now();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(8)));
  const payload = `${ts}.${nonce}`;
  const sig = b64url(await crypto.subtle.sign('HMAC', await getTokenKey(), enc.encode(payload)));
  return `${payload}.${sig}`;
}

async function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = b64url(await crypto.subtle.sign('HMAC', await getTokenKey(), enc.encode(`${ts}.${nonce}`)));
  if (!ctEqual(sig, expected)) return false;
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= TOKEN_TTL;
}

/* ------------------------------------------------------------------ */
/* 限流（isolate 内近似；平台网关另有站点级访问控制）                    */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();
const sessionBuckets = new Map();
let modelCallsThisHour = 0;
let modelHourStarted = Date.now();
let activeModelCalls = 0;

function clientIp(request) {
  const forwarded = String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || 'shared';
}

function rateLimit(map, key, max, windowMs) {
  const now = Date.now();
  if (map.size > 5000) map.clear();
  let bucket = map.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/* ------------------------------------------------------------------ */
/* 模型缓存：isolate 内存 L1 + 站点数据库 L2（保证同问同答跨 isolate）   */
/* ------------------------------------------------------------------ */

const l1 = new Map();

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

async function cacheGet(db, key) {
  const hit = l1.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (!db) return null;
  try {
    const { data, error } = await db.from('oracle_cache').select('value,expires').eq('key', key).limit(1);
    if (error || !data?.length) return null;
    const expires = Number(data[0].expires);
    if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    l1.set(key, { value: data[0].value, expires });
    return data[0].value;
  } catch {
    return null;
  }
}

async function cacheSet(db, key, value) {
  const expires = Date.now() + CACHE_TTL;
  if (l1.size >= 500) l1.delete(l1.keys().next().value);
  l1.set(key, { value, expires });
  if (!db) return;
  try {
    await db.from('oracle_cache').upsert({ key, value, expires }, { onConflict: 'key' });
    if (Math.random() < 0.02) await db.from('oracle_cache').delete().lt('expires', Date.now());
  } catch {
    // 缓存尽力而为：数据库不可用时判词照常落笔
  }
}

async function callDecision(payload, db, apiKey) {
  if (!apiKey) {
    const error = new Error('NO_KEY');
    error.reason = 'no_key';
    throw error;
  }
  if (Date.now() - modelHourStarted > 3600000) {
    modelHourStarted = Date.now();
    modelCallsThisHour = 0;
  }
  if (modelCallsThisHour >= CONFIG.globalModelLimit) {
    const error = new Error('GLOBAL_QUOTA');
    error.reason = 'quota';
    throw error;
  }
  if (activeModelCalls >= 4) {
    const error = new Error('BUSY');
    error.reason = 'busy';
    throw error;
  }

  const key = Array.from(await sha256(enc.encode(stableStringify(payload)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const cached = await cacheGet(db, key);
  if (cached) return { data: cached, cached: true };

  activeModelCalls += 1;
  modelCallsThisHour += 1;
  try {
    const response = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const error = new Error(`UPSTREAM_${response.status}`);
      error.reason = response.status === 401 || response.status === 403 ? 'auth' : 'error';
      throw error;
    }
    const data = await response.json();
    if (!data?.answers || typeof data.answers !== 'object') {
      const error = new Error('BAD_RESPONSE');
      error.reason = 'error';
      throw error;
    }
    await cacheSet(db, key, data);
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

async function decide(payload, local, normalize, pickMap, db, apiKey) {
  if (!apiKey) {
    return { decision: local, source: 'local', cached: false, fallbackReason: 'no_key', fallbackText: fallbackLabel('no_key') };
  }
  try {
    const result = await callDecision(payload, db, apiKey);
    return {
      decision: normalize(result.data, local, pickMap),
      source: 'model',
      cached: result.cached,
      fallbackReason: null,
      fallbackText: ''
    };
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? 'timeout' : (error.reason || 'error');
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
/* 输入清洗（与本机 server.js 同规矩）                                  */
/* ------------------------------------------------------------------ */

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

async function readJsonBody(request, limit = 32 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        const error = new Error('body too large');
        error.status = 413;
        error.code = 'BODY_TOO_LARGE';
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('invalid json');
    error.status = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                               */
/* ------------------------------------------------------------------ */

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const sendError = (status, code, message) => json({ ok: false, error: { code, message } }, status);

export function application({ db }) {
  async function handleDivine(request, apiKey) {
    const body = await readJsonBody(request);
    const input = sanitizeReadingInput(body);
    const preAnalysis = analyzeQuestion(input.question, input.options);
    if (input.mode === 'verdict' && preAnalysis.kind === 'choice' && preAnalysis.choices.length >= 2) {
      input.mode = 'choice';
      input.options = preAnalysis.choices;
    }
    const profile = buildProfile(input);
    const { payload, local, analysis, pickMap } = buildDecisionRequest(input, profile);
    const result = await decide(payload, local, (data, fallback) => normalizeModelDecision(data, fallback, pickMap), pickMap, db, apiKey);
    const reading = composeReading(input, profile, result.decision);
    reading.meta.cached = result.cached;
    reading.meta.fallbackReason = result.fallbackReason;
    reading.meta.fallbackText = result.fallbackText;
    return json({
      ok: true,
      reading,
      profile: publicProfile(profile),
      analysis: { domain: analysis.domain, domainLabel: analysis.domainLabel, kind: analysis.kind, choices: analysis.choices },
      meta: {
        source: result.source,
        online: Boolean(apiKey),
        cached: result.cached,
        fallbackReason: result.fallbackReason,
        fallbackText: result.fallbackText
      }
    });
  }

  async function handleMatch(request, apiKey) {
    const body = await readJsonBody(request);
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
    if (!personA.name || !personB.name) return sendError(400, 'NAME_REQUIRED', '两个人的名字都要写。');
    const { payload, local } = buildMatchRequest(personA, personB);
    const result = await decide(payload, local, (data, fallback) => normalizeMatchDecision(data, fallback), undefined, db, apiKey);
    const reading = composeMatch(personA, personB, result.decision);
    reading.meta.cached = result.cached;
    reading.meta.fallbackReason = result.fallbackReason;
    reading.meta.fallbackText = result.fallbackText;
    return json({
      ok: true,
      reading,
      personA: publicProfile(personA),
      personB: publicProfile(personB),
      meta: {
        source: result.source,
        online: Boolean(apiKey),
        cached: result.cached,
        fallbackReason: result.fallbackReason,
        fallbackText: result.fallbackText
      }
    });
  }

  async function handleDraw(request, apiKey) {
    const body = await readJsonBody(request);
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
    const result = await decide(payload, local, (data, fallback) => normalizeDrawDecision(data, fallback), undefined, db, apiKey);
    const lot = LOTS.find((x) => x.id === result.decision.lotId) || LOTS[0];
    const reading = composeLot(lot, input, profile, result.decision);
    reading.meta.cached = result.cached;
    reading.meta.fallbackReason = result.fallbackReason;
    reading.meta.fallbackText = result.fallbackText;
    return json({
      ok: true,
      reading,
      profile: publicProfile(profile),
      meta: {
        source: result.source,
        online: Boolean(apiKey),
        cached: result.cached,
        fallbackReason: result.fallbackReason,
        fallbackText: result.fallbackText
      }
    });
  }

  return async (ctx) => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    // 网关保留后缀，但会把逻辑名 app 换成部署的物理 Function 名。
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) return sendError(404, 'NOT_FOUND', '没有这个接口。');
    const path = match[1] || '/';

    try {
      const apiKey = await getApiKey();

      if (path === '/health' && request.method === 'GET') {
        return json({
          ok: true,
          online: Boolean(apiKey),
          model: apiKey ? CONFIG.model : null,
          engine: 'local-oracle-v1',
          uptime: Math.round((Date.now() - STARTED) / 1000)
        });
      }

      if (path === '/session' && request.method === 'GET') {
        if (!rateLimit(sessionBuckets, clientIp(request), 120, 60000)) {
          return sendError(429, 'RATE_LIMITED', '请求太频繁，先歇一秒。');
        }
        return json({
          ok: true,
          token: await issueToken(),
          expiresIn: TOKEN_TTL,
          online: Boolean(apiKey),
          model: apiKey ? CONFIG.model : null,
          engine: 'local-oracle-v1'
        });
      }

      if (path === '/divine' || path === '/match' || path === '/draw') {
        if (request.method !== 'POST') return sendError(405, 'METHOD_NOT_ALLOWED', '只接受 POST。');
        if (!rateLimit(rateBuckets, clientIp(request), CONFIG.rateMax, CONFIG.rateWindow)) {
          return sendError(429, 'RATE_LIMITED', '香火太旺，先歇一会儿再来。');
        }
        if (!await verifyToken(request.headers.get('x-oracle-token'))) {
          return sendError(401, 'TOKEN_INVALID', '天机令牌失效，刷新页面再试。');
        }
        if (!String(request.headers.get('content-type') || '').includes('application/json')) {
          return sendError(415, 'CONTENT_TYPE', '请求必须是 JSON。');
        }
        if (path === '/divine') return await handleDivine(request, apiKey);
        if (path === '/match') return await handleMatch(request, apiKey);
        return await handleDraw(request, apiKey);
      }

      if (path === '/health' || path === '/session') {
        return sendError(405, 'METHOD_NOT_ALLOWED', '只接受 GET。');
      }
      return sendError(404, 'NOT_FOUND', '没有这个接口。');
    } catch (error) {
      if (error.status) return sendError(error.status, error.code || 'BAD_REQUEST', error.message);
      return sendError(500, 'INTERNAL', '天机紊乱了一下，再试一次。');
    }
  };
}