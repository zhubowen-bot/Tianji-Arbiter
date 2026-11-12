import {
  buildProfile, buildDaily, analyzeQuestion, extractChoices,
  buildLocalDecision, composeReading,
  buildLocalMatch, composeMatch,
  buildLocalLotDecision, composeLot,
  matchSmalltalk, smalltalkReply,
  todayKey
} from './engine.js?v=16';
import { EXAMPLE_QUESTIONS, ELEMENTS, LOTS, RITUAL_LINES } from './data.js?v=16';

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略存储失败 */
  }
}

function toast(message, type = '') {
  const stack = $('#toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function formatShortDate(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ */
/* 全局状态                                                           */
/* ------------------------------------------------------------------ */

const STORE = {
  profile: 'oracle_profile_v1',
  partner: 'oracle_partner_v1',
  history: 'oracle_history_v1',
  merit: 'oracle_merit_v1',
  achievements: 'oracle_achievements_v1',
  flags: 'oracle_flags_v1',
  sound: 'oracle_sound_v1'
};

const savedHistory = readStorage(STORE.history, []);
const savedAchievements = readStorage(STORE.achievements, {});
const savedFlags = readStorage(STORE.flags, {});

const state = {
  session: null,
  online: false,
  mode: 'verdict',
  profile: null,
  partner: null,
  route: 'home',
  ledgerFilter: 'all',
  chatDomain: '',
  currentReading: null,
  choiceReading: null,
  matchReading: null,
  currentLot: null,
  chartProfile: null,
  chartSignature: '',
  chat: [],
  daily: null,
  dailyDate: '',
  history: Array.isArray(savedHistory) ? savedHistory : [],
  merit: Number(readStorage(STORE.merit, 0)) || 0,
  achievements: savedAchievements && typeof savedAchievements === 'object' && !Array.isArray(savedAchievements) ? savedAchievements : {},
  flags: savedFlags && typeof savedFlags === 'object' && !Array.isArray(savedFlags) ? savedFlags : {},
  sound: readStorage(STORE.sound, false) === true,
  busy: false,
  ritualRunning: false,
  extraAskChoices: [],
  extraArenaChoices: []
};

let pendingScroll = '';

const ACHIEVEMENTS = [
  { key: 'first', icon: '初', name: '初次问卦', test: () => state.history.length >= 1 },
  { key: 'three', icon: '三', name: '三界通判', test: () => new Set(state.history.filter((x) => x.type === 'reading').map((x) => x.reading?.answer?.domain)).size >= 3 },
  { key: 'five', icon: '五', name: '香火渐旺', test: () => state.history.length >= 5 },
  { key: 'chat', icon: '问', name: '直问判官', test: () => Boolean(state.flags.chat) },
  { key: 'lot', icon: '签', name: '签上有名', test: () => Boolean(state.flags.lot) },
  { key: 'match', icon: '缘', name: '缘分观察员', test: () => Boolean(state.flags.match) },
  { key: 'chart', icon: '命', name: '照见命盘', test: () => Boolean(state.flags.chart) },
  { key: 'share', icon: '传', name: '传阅天机', test: () => Boolean(state.flags.share) },
  { key: 'merit10', icon: '香', name: '十炷香', test: () => state.merit >= 10 },
  { key: 'merit50', icon: '诚', name: '五十炷香', test: () => state.merit >= 50 }
];

/* ------------------------------------------------------------------ */
/* 音效                                                               */
/* ------------------------------------------------------------------ */

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playTone(freq, delay = 0, duration = 0.5, volume = 0.04) {
  if (!state.sound) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ctx.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function playChime(kind = 'soft') {
  if (!state.sound) return;
  if (kind === 'start') {
    playTone(392, 0, 0.55, 0.035);
    playTone(523.25, 0.12, 0.6, 0.03);
    playTone(659.25, 0.26, 0.75, 0.025);
  } else if (kind === 'success') {
    playTone(523.25, 0, 0.6, 0.035);
    playTone(659.25, 0.1, 0.6, 0.03);
    playTone(783.99, 0.2, 0.8, 0.025);
  } else if (kind === 'merit') {
    playTone(880, 0, 0.35, 0.022);
    playTone(1174.66, 0.06, 0.4, 0.016);
  } else {
    playTone(440, 0, 0.35, 0.02);
  }
}

function setupSound() {
  const btn = $('#soundToggle');
  const apply = () => {
    btn.classList.toggle('muted', !state.sound);
    btn.setAttribute('aria-label', state.sound ? '关闭音效' : '开启音效');
    btn.title = state.sound ? '关闭音效' : '开启音效';
  };
  apply();
  btn.addEventListener('click', () => {
    state.sound = !state.sound;
    writeStorage(STORE.sound, state.sound);
    apply();
    if (state.sound) {
      playChime('success');
      toast('音效已开启', 'gold');
    } else {
      toast('音效已关闭');
    }
  });
}

/* ------------------------------------------------------------------ */
/* 会话与 API                                                         */
/* ------------------------------------------------------------------ */

let apiBasePromise = null;
function resolveApiBase() {
  if (!apiBasePromise) {
    apiBasePromise = (async () => {
      try {
        const res = await fetch('/functions/v1/app/health', { headers: { accept: 'application/json' } });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = await res.json().catch(() => null);
          if (data?.ok) return '/functions/v1/app';
        }
      } catch {
        // 本机 Node 服务或纯静态托管：回退 /api
      }
      return '/api';
    })();
  }
  return apiBasePromise;
}

async function initSession() {
  try {
    const base = await resolveApiBase();
    const res = await fetch(`${base}/session`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('session failed');
    const data = await res.json();
    state.session = data;
    state.online = Boolean(data.online);
    updateOnlineUI();
    return data;
  } catch {
    state.session = { token: null, online: false };
    state.online = false;
    updateOnlineUI();
    return null;
  }
}

function updateOnlineUI() {
  const online = state.online;
  const status = $('#onlineStatus');
  status.classList.toggle('is-offline', !online);
  status.querySelector('span').textContent = online ? '决策模型在线' : '本地玄机在线';

  const chip = $('#modelChip');
  chip.classList.toggle('is-local', !online);
  chip.innerHTML = `<i></i> ${online ? '决策模型 · 已连线' : '本地玄机 · 离线可用'}`;

  const chatStatus = $('#chatStatus');
  if (chatStatus) chatStatus.textContent = online ? '决策模型已连线，直接问，判官直接答。' : '模型暂时离线，本地玄机引擎照样给你答案。';
  const chatModel = $('#chatModel');
  if (chatModel) chatModel.textContent = online ? 'decision-model-preview' : 'local-oracle-v1';
}

async function api(path, body, retry = true) {
  if (!state.session?.token) await initSession();
  const base = await resolveApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const res = await fetch(base + path.slice(4), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oracle-token': state.session?.token || ''
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (res.status === 401 && retry) {
      await initSession();
      return api(path, body, false);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message || '天机紊乱，再试一次。');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 本地兜底判词                                                       */
/* ------------------------------------------------------------------ */

function localDivine(payload) {
  const input = {
    question: payload.question,
    mode: payload.mode,
    options: payload.options || [],
    name: payload.name || '',
    birth: payload.birth || '',
    time: payload.time || '',
    gender: payload.gender || '',
    contextDomain: payload.contextDomain || ''
  };
  const profile = buildProfile(input);
  const analysis = analyzeQuestion(input.question, input.options, { domain: input.contextDomain });
  const decision = buildLocalDecision(input, profile, analysis);
  const reading = composeReading(input, profile, decision);
  reading.meta.fallbackText = '本地玄机引擎';
  return { reading, profile, meta: { source: 'local', online: false } };
}

function localMatch(aName, aBirth, aTime, bName, bBirth, bTime) {
  const a = buildProfile({ name: aName, birth: aBirth, time: aTime });
  const b = buildProfile({ name: bName, birth: bBirth, time: bTime });
  const decision = buildLocalMatch(a, b);
  const reading = composeMatch(a, b, decision);
  reading.meta.fallbackText = '本地玄机引擎';
  return { reading, personA: a, personB: b };
}

function localLot(input) {
  const profile = buildProfile({ name: input.name, birth: input.birth });
  const decision = buildLocalLotDecision(input);
  const lot = LOTS.find((x) => x.id === decision.lotId) || LOTS[0];
  const reading = composeLot(lot, input, profile, decision);
  reading.meta.fallbackText = '本地玄机引擎';
  return { reading, profile };
}

/* ------------------------------------------------------------------ */
/* 仪式动画                                                           */
/* ------------------------------------------------------------------ */

async function runRitual() {
  if (state.ritualRunning) return;
  state.ritualRunning = true;
  const overlay = $('#ritualOverlay');
  const line = $('#ritualLine');
  const glyph = $('#ritualGlyph');
  const bar = $('#ritualBar');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  overlay.hidden = false;
  bar.style.width = '0%';
  const glyphs = ['判', '乾', '坎', '离', '震', '卦', '断'];
  const step = reduced ? 90 : 280;
  for (let i = 0; i < RITUAL_LINES.length; i++) {
    line.textContent = RITUAL_LINES[i];
    glyph.textContent = glyphs[i % glyphs.length];
    bar.style.width = `${Math.round(((i + 1) / RITUAL_LINES.length) * 100)}%`;
    playTone(320 + i * 46, 0, 0.18, 0.012);
    await sleep(step);
  }
  await sleep(reduced ? 100 : 260);
  overlay.hidden = true;
  state.ritualRunning = false;
}

/* ------------------------------------------------------------------ */
/* 命帖：中央身份存储，全站同步                                        */
/* ------------------------------------------------------------------ */

function cleanProfile(raw = {}) {
  return {
    name: String(raw.name || '').trim().slice(0, 24),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(raw.birth || '') ? raw.birth : '',
    time: /^\d{1,2}:\d{2}$/.test(raw.time || '') ? raw.time : '',
    gender: ['male', 'female', 'other'].includes(raw.gender) ? raw.gender : ''
  };
}

function isEmptyIdentity(p) {
  return !p.name && !p.birth && !p.time && !p.gender;
}

function getProfile() {
  return state.profile || { name: '', birth: '', time: '', gender: '' };
}

function updateProfile(patch) {
  const clean = cleanProfile({ ...getProfile(), ...patch });
  state.profile = isEmptyIdentity(clean) ? null : clean;
  writeStorage(STORE.profile, state.profile);
  syncProfileUI();
}

function getPartner() {
  return state.partner || { name: '', birth: '', time: '' };
}

function updatePartner(patch) {
  const merged = { ...getPartner(), ...patch };
  const clean = {
    name: String(merged.name || '').trim().slice(0, 24),
    birth: /^\d{4}-\d{2}-\d{2}$/.test(merged.birth || '') ? merged.birth : '',
    time: /^\d{1,2}:\d{2}$/.test(merged.time || '') ? merged.time : ''
  };
  state.partner = (clean.name || clean.birth || clean.time) ? clean : null;
  writeStorage(STORE.partner, state.partner);
  syncPartnerUI();
}

function syncProfileUI() {
  const p = getProfile();
  for (const el of $$('[data-profile]')) {
    const value = p[el.dataset.profile] || '';
    if (el.value !== value) el.value = value;
  }

  const chip = $('#identityChip');
  const chipName = $('#identityName');
  if (chip && chipName) {
    const has = Boolean(p.name || p.birth);
    chip.classList.toggle('has-profile', has);
    chipName.textContent = p.name || (p.birth ? '命帖已立' : '立命帖');
    chip.title = has ? `命帖：${[p.name, p.birth, p.time].filter(Boolean).join(' · ')}（点击管理）` : '立一次命帖，全站共用';
  }

  const strip = $('#askIdentity');
  if (strip) {
    if (p.name || p.birth) {
      const bits = [p.name, p.birth, p.time].filter(Boolean).map(escapeHtml);
      strip.innerHTML = `<span class="identity-strip-seal">帖</span><span class="identity-strip-text">命帖随行：${bits.join(' · ')}</span><a href="#/profile">管理命帖 →</a>`;
    } else {
      strip.innerHTML = '<span class="identity-strip-seal">帖</span><span class="identity-strip-text">还没立命帖。填一次生辰，七殿共用。</span><a href="#/profile">去立帖 →</a>';
    }
  }

  const chatNote = $('#chatIdentityNote');
  if (chatNote) {
    chatNote.textContent = p.name || p.birth
      ? `判官已带上你的命帖${p.name ? `（${p.name}）` : ''}。对话上下文仅本轮有效，刷新即清空。`
      : '判官会记住这一轮对话的前几句，仅用于让回答更连贯。刷新页面即清空。去「我的命帖」立帖后，问答会自动带上你的生辰。';
  }

  if (state.route === 'profile') renderProfilePreview();
}

function syncPartnerUI() {
  const p = getPartner();
  for (const el of $$('[data-partner]')) {
    const value = p[el.dataset.partner] || '';
    if (el.value !== value) el.value = value;
  }
}

function setupIdentityBinding() {
  const handler = (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.profile) {
      updateProfile({ [el.dataset.profile]: el.value });
    } else if (el.dataset.partner) {
      updatePartner({ [el.dataset.partner]: el.value });
    }
  };
  document.addEventListener('input', handler);
  document.addEventListener('change', handler);
}

function renderProfilePreview() {
  const box = $('#profilePreview');
  if (!box) return;
  const p = getProfile();
  if (!p.birth) {
    box.innerHTML = `
      <div class="chart-placeholder">
        <span class="placeholder-seal">帖</span>
        <p>填上出生日期，这里会即时排出你的简盘。命帖一立，七殿同用。</p>
      </div>`;
    return;
  }
  const profile = buildProfile(p);
  if (!profile.valid) {
    box.innerHTML = `
      <div class="chart-placeholder">
        <span class="placeholder-seal">帖</span>
        <p>这个日期判官看不太懂，检查一下是不是填错了。</p>
      </div>`;
    return;
  }
  renderChart(profile, '#profilePreview');
}

function setupProfilePage() {
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    writeStorage(STORE.profile, state.profile);
    playChime('soft');
    toast('命帖已保存，七殿共用。', 'gold');
  });
  $('#profileClear').addEventListener('click', () => {
    if (!state.profile) {
      toast('命帖本来就是空的。');
      return;
    }
    if (!window.confirm('确定清空命帖吗？所有殿的生辰信息会一起清空。')) return;
    updateProfile({ name: '', birth: '', time: '', gender: '' });
    toast('命帖已清空。');
  });
  $('#partnerClear').addEventListener('click', () => {
    if (!state.partner) {
      toast('还没记下任何人。');
      return;
    }
    updatePartner({ name: '', birth: '', time: '' });
    toast('判官替你忘了 TA。');
  });
}

function initDateLimits() {
  const today = todayKey();
  for (const el of $$('input[type="date"][data-profile="birth"], input[type="date"][data-partner="birth"]')) {
    el.max = today;
  }
}

/* ------------------------------------------------------------------ */
/* 路由：一页一殿                                                      */
/* ------------------------------------------------------------------ */

const ROUTES = {
  home: { title: '天机判官 · 只给一个答案的 AI 命理判官' },
  ask: { title: '问事殿 · 天机判官' },
  daily: { title: '每日阁 · 天机判官' },
  choose: { title: '抉择擂台 · 天机判官' },
  match: { title: '合盘院 · 天机判官' },
  lot: { title: '灵签阁 · 天机判官' },
  chart: { title: '命格堂 · 天机判官' },
  chat: { title: '问答房 · 天机判官' },
  profile: { title: '我的命帖 · 天机判官' },
  ledger: { title: '香火簿 · 天机判官' }
};

function routeFromHash() {
  const key = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return ROUTES[key] ? key : 'home';
}

function navigate(route) {
  const target = `#/${route}`;
  const current = location.hash || '#/';
  if (current === target || (route === 'home' && (current === '#' || current === '#top'))) {
    renderRoute();
  } else {
    location.hash = target;
  }
}

function renderRoute() {
  const route = routeFromHash();
  const changed = route !== state.route;
  state.route = route;

  for (const page of $$('.page')) {
    page.hidden = page.dataset.page !== route;
  }
  for (const link of $$('[data-nav]')) {
    const active = link.dataset.nav === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = ROUTES[route].title;

  const nav = $('#mainNav');
  nav.classList.remove('open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');

  if (changed) window.scrollTo(0, 0);
  onEnterRoute(route);

  if (pendingScroll) {
    const target = $(pendingScroll);
    pendingScroll = '';
    if (target) setTimeout(() => scrollToEl(target), 80);
  }
}

function onEnterRoute(route) {
  if (route === 'daily') {
    if (!state.daily || state.dailyDate !== todayKey()) {
      renderDaily(getProfile());
    }
  } else if (route === 'chart') {
    const p = getProfile();
    if (p.birth && state.chartSignature !== `${p.birth}|${p.time}|${p.gender}|${p.name}`) {
      const profile = buildProfile(p);
      if (profile.valid) renderChart(profile);
    }
  } else if (route === 'profile') {
    renderProfilePreview();
  } else if (route === 'ledger') {
    renderAchievements();
    renderHistory();
    updateLedgerBadge();
  } else if (route === 'chat') {
    const box = $('#chatMessages');
    box.scrollTop = box.scrollHeight;
  }
}

function setupRouter() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

/* ------------------------------------------------------------------ */
/* 模式与示例                                                         */
/* ------------------------------------------------------------------ */

function setMode(mode, options = {}) {
  state.mode = ['verdict', 'choice', 'score'].includes(mode) ? mode : 'verdict';
  $$('.mode-tabs button').forEach((btn) => {
    const active = btn.dataset.mode === state.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const choiceFields = $('#choiceFields');
  choiceFields.hidden = state.mode !== 'choice';
  const textarea = $('#questionInput');
  const placeholders = {
    verdict: '例如：我该不该辞掉现在的工作？',
    choice: '例如：留在大城市继续拼，还是回老家稳定下来？',
    score: '例如：我今年的财运怎么样？'
  };
  textarea.placeholder = placeholders[state.mode];
  const submit = $('#askSubmit span');
  if (submit) submit.textContent = state.mode === 'choice' ? '让判官选' : state.mode === 'score' ? '判一段运势' : '请判官落笔';
  if (options.question) textarea.value = options.question;
  if (state.mode === 'choice' && !options.choices?.length && !$('#choiceA').value && !$('#choiceB').value) {
    const parsed = extractChoices(textarea.value);
    if (parsed.length >= 2) {
      $('#choiceA').value = parsed[0] || '';
      $('#choiceB').value = parsed[1] || '';
      clearExtraChoices();
      for (const choice of parsed.slice(2, 6)) addAskChoice(choice);
    }
  }
  if (options.choices?.length >= 2) {
    $('#choiceA').value = options.choices[0] || '';
    $('#choiceB').value = options.choices[1] || '';
    clearExtraChoices();
    for (const choice of options.choices.slice(2, 6)) addAskChoice(choice);
  }
  updateCharCount();
}

function updateCharCount() {
  const value = $('#questionInput').value;
  $('#charCount').textContent = String(value.length);
}

function renderExamples() {
  const row = $('#exampleChips');
  row.innerHTML = EXAMPLE_QUESTIONS.map((ex, i) => (
    `<button type="button" data-index="${i}" data-example-mode="${ex.mode}">${escapeHtml(ex.text)}</button>`
  )).join('');
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (!btn) return;
    const ex = EXAMPLE_QUESTIONS[Number(btn.dataset.index)];
    if (!ex) return;
    let choices = [];
    if (ex.mode === 'choice') choices = extractChoices(ex.text);
    setMode(ex.mode, { question: ex.text, choices });
    $('#questionInput').focus();
    playTone(520, 0, 0.2, 0.015);
  });
}

function clearExtraChoices() {
  state.extraAskChoices = [];
  $('#extraChoices').innerHTML = '';
}

function addAskChoice(value = '') {
  if (state.extraAskChoices.length >= 4) {
    toast('最多六个选项，判官已经够难选了。');
    return;
  }
  const index = state.extraAskChoices.length;
  const letter = String.fromCharCode(67 + index);
  const row = document.createElement('div');
  row.className = 'choice-row';
  row.innerHTML = `<span class="option-mark">${letter}</span><input maxlength="40" placeholder="选项 ${letter}"><button type="button" class="text-btn" aria-label="删除选项">移除</button>`;
  const input = row.querySelector('input');
  input.value = value;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    state.extraAskChoices = state.extraAskChoices.filter((x) => x.row !== row);
    reletterAskChoices();
  });
  $('#extraChoices').appendChild(row);
  state.extraAskChoices.push({ row, input });
  if (!value) input.focus();
}

function reletterAskChoices() {
  state.extraAskChoices.forEach((item, i) => {
    const letter = String.fromCharCode(67 + i);
    item.row.querySelector('.option-mark').textContent = letter;
    item.input.placeholder = `选项 ${letter}`;
  });
}

function collectAskOptions() {
  const values = [$('#choiceA')?.value, $('#choiceB')?.value]
    .concat(state.extraAskChoices.map((x) => x.input.value))
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* 主问事                                                             */
/* ------------------------------------------------------------------ */

function setBusy(button, busy, busyText = '天机落笔中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.original) button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span>${escapeHtml(busyText)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }
}

async function handleAskSubmit(event) {
  event.preventDefault();
  if (state.busy) return;
  const question = $('#questionInput').value.trim();
  if (question.length < 2) {
    toast('先写下你的问题，至少两个字。', 'bad');
    $('#questionInput').focus();
    return;
  }

  let options = [];
  if (state.mode === 'choice') {
    options = collectAskOptions();
    if (options.length < 2) {
      options = extractChoices(question);
      if (options.length >= 2) {
        $('#choiceA').value = options[0] || '';
        $('#choiceB').value = options[1] || '';
        clearExtraChoices();
        for (const choice of options.slice(2, 6)) addAskChoice(choice);
      }
    }
    if (options.length < 2) {
      toast('二选一至少要有两个选项，写进问题里也行。', 'bad');
      return;
    }
  }

  const profile = getProfile();
  const payload = {
    question,
    mode: state.mode,
    options,
    name: profile.name,
    birth: profile.birth,
    time: profile.time,
    gender: profile.gender
  };

  state.busy = true;
  addMerit(1);
  playChime('start');
  setBusy($('#askSubmit'), true);
  const ritual = runRitual();
  try {
    const data = await api('/api/divine', payload);
    await ritual;
    renderReading(data.reading);
    pushHistory('reading', data.reading);
    checkAchievements();
    playChime('success');
    if (data.reading.meta.source === 'local') {
      toast('模型暂时离线，本地玄机已替你落笔。', 'gold');
    }
    scrollToEl($('#resultPanel'));
  } catch (error) {
    await ritual;
    const data = localDivine(payload);
    renderReading(data.reading);
    pushHistory('reading', data.reading);
    checkAchievements();
    playChime('success');
    toast('天机线路不稳，本地玄机已替你落笔。', 'gold');
    scrollToEl($('#resultPanel'));
  } finally {
    state.busy = false;
    setBusy($('#askSubmit'), false);
  }
}

/* ------------------------------------------------------------------ */
/* 结果渲染                                                           */
/* ------------------------------------------------------------------ */

function sourceBadge(meta = {}) {
  if (meta.source === 'model') {
    const latency = meta.latencyMs ? `${Math.round(meta.latencyMs)}ms` : '';
    return `<span class="source-badge">决策模型${meta.cached ? ' · 缓存' : ''}${latency ? ` · ${latency}` : ''}</span>`;
  }
  return '<span class="source-badge local">本地玄机引擎</span>';
}

function meterBlock(label, value, suffix = '%') {
  return `
    <div class="bar-block">
      <div class="bar-label"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}${suffix}</b></div>
      <div class="meter"><i data-width="${Math.max(0, Math.min(100, Number(value) || 0))}"></i></div>
    </div>`;
}

function animateMeters(root = document) {
  requestAnimationFrame(() => {
    $$('.meter i[data-width]', root).forEach((el) => {
      el.style.width = `${el.dataset.width}%`;
    });
  });
}

function renderReading(reading) {
  if (!reading) return;
  state.currentReading = reading;
  const a = reading.answer;
  const isChoice = reading.mode === 'choice';
  const isScore = reading.mode === 'score';
  const panel = $('#resultPanel');
  const ringValue = isScore ? a.fortune : a.probability;
  const ringLabel = isScore ? '气运指数' : isChoice ? '选中概率' : '判词把握';
  const sealText = isChoice ? '选' : a.verdict;
  const sealClass = String(sealText).length > 2 ? 'verdict-seal long' : 'verdict-seal';
  const element = ELEMENTS[a.element] || ELEMENTS.earth;
  const lucky = reading.lucky || {};
  const optionBars = isChoice && safeArray(a.optionProbabilities).length
    ? `<div class="option-bars">${a.optionProbabilities.map((opt) => {
      const prob = Math.round((Number(opt.probability) || 0) * 100);
      const winner = opt.label === a.verdict;
      return `<div class="option-bar ${winner ? 'winner' : ''}"><span>${escapeHtml(opt.label)}</span><div class="meter"><i data-width="${prob}"></i></div><b>${prob}%</b></div>`;
    }).join('')}</div>`
    : '';

  const detailHtml = safeArray(reading.detail).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const actionsHtml = safeArray(reading.actions).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const avoidHtml = safeArray(reading.avoid).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const yiHtml = safeArray(reading.yi).map((x) => `<span class="tag yi">${escapeHtml(x)}</span>`).join('');
  const jiHtml = safeArray(reading.ji).map((x) => `<span class="tag ji">${escapeHtml(x)}</span>`).join('');
  const poemHtml = safeArray(reading.poem).map((line) => `<p>${escapeHtml(line)}</p>`).join('');

  panel.innerHTML = `
    <article class="result-card">
      <div class="result-top">
        <div class="result-kicker">
          <b>天机第 ${state.history.length + 1} 判</b>
          <span>·</span>
          <span>${escapeHtml(a.domainLabel)}局</span>
          ${sourceBadge(reading.meta)}
        </div>
        <div class="result-meta">
          <span>天机码 <code>${escapeHtml(reading.signature)}</code></span>
          <span>${isChoice || isScore ? '置信' : '把握'} <b>${Math.round(a.confidence || 0)}%</b></span>
          <span>${escapeHtml(formatShortDate(reading.createdAt))}</span>
        </div>
      </div>

      <div class="result-hero">
        <div class="${sealClass}">${escapeHtml(sealText)}</div>
        <div class="verdict-copy">
          <h2>${escapeHtml(reading.headline)}</h2>
          <p class="verdict-question">${escapeHtml(reading.question)}</p>
        </div>
        <div class="score-ring" style="--p:${Math.max(0, Math.min(100, Number(ringValue) || 0))}">
          <div class="score-ring-inner"><b>${Math.round(ringValue)}</b><span>${escapeHtml(ringLabel)}</span></div>
        </div>
      </div>

      <div class="result-bars">
        ${meterBlock(ringLabel, Math.round(ringValue), isScore ? '' : '%')}
        ${isChoice || isScore
          ? meterBlock('决断置信', Math.round(a.confidence || 0), '%')
          : meterBlock('气运指数', Math.round(a.fortune || 0), '')}
      </div>

      ${optionBars}

      <div class="result-grid">
        <div class="verdict-detail">${detailHtml}</div>
        <div class="hex-card">
          <div class="hex-symbol">${escapeHtml(a.hexagram?.symbol || '䷀')}</div>
          <div class="hex-name">${escapeHtml(a.hexagram?.name || '乾为天')}</div>
          <p class="hex-judgment">${escapeHtml(a.hexagram?.judgment || '')}</p>
          <div class="hex-trigrams">
            <span>上卦 ${escapeHtml(a.upper?.name || '')}${escapeHtml(a.upper?.symbol || '')}</span>
            <span>下卦 ${escapeHtml(a.lower?.name || '')}${escapeHtml(a.lower?.symbol || '')}</span>
          </div>
        </div>
      </div>

      <div class="poem-card">
        <span class="poem-label">判 官 批 语</span>
        ${poemHtml}
      </div>

      <div class="info-grid">
        <div class="info-tile"><span>应期</span><b>${escapeHtml(a.timing?.label || '')}</b><small>${escapeHtml(a.timing?.short || '')}</small></div>
        <div class="info-tile"><span>助运五行</span><b>${escapeHtml(element.label)}</b><small>${escapeHtml(element.trait)}</small></div>
        <div class="info-tile"><span>幸运方位</span><b>${escapeHtml(lucky.direction || element.direction)}</b><small>${escapeHtml(lucky.color || element.color)}</small></div>
        <div class="info-tile"><span>幸运数字</span><b>${escapeHtml(lucky.number || element.number)}</b><small>${escapeHtml(lucky.time || '')}</small></div>
      </div>

      <div class="result-columns">
        <div class="list-card">
          <h4>判官让你做</h4>
          <ul>${actionsHtml}</ul>
        </div>
        <div class="list-card avoid">
          <h4>最好别做</h4>
          <ul>${avoidHtml}</ul>
        </div>
      </div>

      <div class="result-columns" style="margin-top:12px">
        <div class="list-card">
          <h4>今日宜</h4>
          <div class="tag-row">${yiHtml}</div>
        </div>
        <div class="list-card">
          <h4>今日忌</h4>
          <div class="tag-row">${jiHtml}</div>
        </div>
      </div>

      <div class="closer">${escapeHtml(reading.closer || '')}</div>

      <div class="result-actions">
        <button type="button" class="btn btn-ghost" data-action="again">再问一卦</button>
        <button type="button" class="btn btn-ghost" data-action="speak-reading">朗读</button>
        <button type="button" class="btn btn-ghost" data-action="copy-reading">复制判词</button>
        <button type="button" class="btn btn-ghost" data-action="share-reading">分享</button>
        <button type="button" class="btn btn-primary" data-action="save-reading"><span>保存判词图</span><i>↓</i></button>
      </div>
    </article>
  `;
  panel.hidden = false;
  animateMeters(panel);
}

function renderChoiceResult(reading) {
  state.choiceReading = reading;
  const a = reading.answer;
  const box = $('#choiceResult');
  const options = safeArray(a.optionProbabilities);
  box.innerHTML = `
    <div class="choice-verdict">
      <div class="verdict-seal">选</div>
      <div>
        <h3>${escapeHtml(reading.headline)}</h3>
        <p>${escapeHtml(reading.question)} · ${sourceBadge(reading.meta)}</p>
      </div>
    </div>
    <div class="option-bars">
      ${options.map((opt) => {
        const prob = Math.round((Number(opt.probability) || 0) * 100);
        return `<div class="option-bar ${opt.label === a.verdict ? 'winner' : ''}"><span>${escapeHtml(opt.label)}</span><div class="meter"><i data-width="${prob}"></i></div><b>${prob}%</b></div>`;
      }).join('')}
    </div>
    <div class="closer" style="margin-top:18px">${escapeHtml(reading.closer || '')}</div>
    <div class="result-actions" style="margin-top:16px;padding-top:0;border-top:0">
      <button type="button" class="btn btn-ghost" data-action="open-choice-result">展开完整判词</button>
      <button type="button" class="btn btn-primary" data-action="copy-choice">复制结论</button>
    </div>
  `;
  box.hidden = false;
  animateMeters(box);
}

function renderMatch(reading) {
  state.matchReading = reading;
  const box = $('#matchResult');
  const score = Math.max(0, Math.min(100, Number(reading.score) || 0));
  box.innerHTML = `
    <article class="match-card">
      <div class="match-top">
        <div class="match-score" style="--p:${score}">
          <div class="match-score-inner"><b>${score}</b><span>契合指数</span></div>
        </div>
        <div class="match-copy">
          <div class="match-tags">
            <span class="tag">${escapeHtml(reading.label)}</span>
            <span class="tag">${escapeHtml(reading.dynamic)}</span>
            ${sourceBadge(reading.meta)}
          </div>
          <h3 style="margin-top:10px">${escapeHtml(reading.headline)}</h3>
          <p>${escapeHtml(reading.names)} · 天机码 ${escapeHtml(reading.signature)}</p>
        </div>
      </div>
      <div class="match-detail">
        <div>
          ${safeArray(reading.detail).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        </div>
        <div class="match-hex">
          <div class="hex-symbol">${escapeHtml(reading.hexagram?.symbol || '䷀')}</div>
          <b>${escapeHtml(reading.hexagram?.name || '')}</b>
          <p class="hex-judgment">${escapeHtml(reading.hexagram?.judgment || '')}</p>
        </div>
      </div>
      <div class="result-actions" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" data-action="match-reset">再合一盘</button>
        <button type="button" class="btn btn-primary" data-action="copy-match">复制合盘</button>
      </div>
    </article>
  `;
  box.hidden = false;
  animateMeters(box);
}

function renderLot(reading) {
  state.currentLot = reading;
  const box = $('#lotResult');
  const lot = reading.lot;
  const lucky = reading.lucky || {};
  const actions = safeArray(reading.actions).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const yi = safeArray(reading.yi).map((x) => `<span class="tag yi">${escapeHtml(x)}</span>`).join('');
  const ji = safeArray(reading.ji).map((x) => `<span class="tag ji">${escapeHtml(x)}</span>`).join('');
  box.innerHTML = `
    <article class="lot-card">
      <div class="lot-card-top">
        <div>
          <span class="lot-level">${escapeHtml(lot.level)} · ${escapeHtml(lot.season)}签</span>
          <h3 class="lot-name">${escapeHtml(lot.name)}</h3>
          <p class="lot-order">第 ${String(lot.id).padStart(2, '0')} 签 / 24 · 天机码 ${escapeHtml(reading.signature)}</p>
          <p style="margin-top:6px;color:var(--muted);font-size:11px">问：${escapeHtml(reading.question || '未写问题')}</p>
        </div>
        <div style="text-align:right">
          ${sourceBadge(reading.meta)}
          <p style="margin-top:8px;color:var(--muted);font-size:10px">${escapeHtml(reading.turn)}</p>
        </div>
      </div>
      <div class="lot-poem">
        ${lot.poem.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      </div>
      <div class="lot-oracle">${escapeHtml(lot.oracle)}</div>
      <div class="lot-detail">
        ${safeArray(reading.detail).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      </div>
      <div class="lot-tags">
        ${lot.keywords.map((k) => `<span class="tag">${escapeHtml(k)}</span>`).join('')}
        ${yi}
        ${ji}
      </div>
      <div class="result-columns" style="margin-top:18px">
        <div class="list-card">
          <h4>签外行动</h4>
          <ul>${actions}</ul>
        </div>
        <div class="list-card">
          <h4>助运</h4>
          <div class="tag-row">
            <span class="tag">五行 ${escapeHtml(lucky.element || '')}</span>
            <span class="tag">颜色 ${escapeHtml(lucky.color || '')}</span>
            <span class="tag">方位 ${escapeHtml(lucky.direction || '')}</span>
            <span class="tag">数字 ${escapeHtml(lucky.number || '')}</span>
          </div>
          <p class="micro-note">抽签结果由判官按你所问之事匹配，建议先看签文，再决定要不要行动。</p>
        </div>
      </div>
      <div class="lot-actions">
        <button type="button" class="btn btn-ghost" data-action="lot-again">换一个问题再摇</button>
        <button type="button" class="btn btn-primary" data-action="copy-lot">复制签文</button>
      </div>
    </article>
  `;
  box.hidden = false;
  animateMeters(box);
}

function renderChart(profile, target = '#chartResult') {
  if (target === '#chartResult') {
    state.chartProfile = profile;
    state.chartSignature = `${profile?.birth || ''}|${profile?.time || ''}|${profile?.gender || ''}|${profile?.name || ''}`;
  }
  const box = $(target);
  if (!box) return;
  if (!profile?.valid) {
    box.innerHTML = `
      <div class="chart-placeholder">
        <span class="placeholder-seal">命</span>
        <p>需要完整的出生日期才能排盘。填好日期，判官才能看见你的牌。</p>
      </div>`;
    return;
  }
  const archetype = profile.archetype || {};
  const pillars = [...safeArray(profile.pillars)];
  if (pillars.length < 4) pillars.push({ label: '时柱', text: '未知', stemElement: '', branchElement: '', estimated: true });
  const elementBars = Object.keys(ELEMENTS).map((key) => {
    const el = ELEMENTS[key];
    const value = profile.elementScores?.[key] || 0;
    return `<div class="element-row">
      <span>${el.label}</span>
      <div class="meter"><i data-width="${Math.max(2, Math.min(100, value))}" style="background:${el.hex}"></i></div>
      <b>${value}%</b>
    </div>`;
  }).join('');
  const lucky = profile.lucky || {};
  box.innerHTML = `
    <article class="chart-card">
      <div class="chart-head">
        <div>
          <span class="card-label">命格档案 · ${escapeHtml(profile.signature)}</span>
          <h3>${escapeHtml(profile.name || '无名氏')} 的命盘</h3>
          <p>${escapeHtml(profile.summary)}</p>
        </div>
        <div class="chart-zodiac">${escapeHtml(profile.zodiac || '命')}</div>
      </div>
      <div class="pillars">
        ${pillars.map((p) => `<div class="pillar"><span>${escapeHtml(p.label)}${p.estimated ? '（示意）' : ''}</span><b>${escapeHtml(p.text)}</b><em>${escapeHtml(ELEMENTS[p.stemElement]?.label || '')}${escapeHtml(ELEMENTS[p.branchElement]?.label || '')}</em></div>`).join('')}
      </div>
      <div class="element-block">
        <h4>五行分布</h4>
        <div class="element-bars">${elementBars}</div>
      </div>
      <div class="archetype-card">
        <div class="archetype-seal">${escapeHtml(archetype.title?.[0] || '命')}</div>
        <div>
          <h4>${escapeHtml(archetype.title || '未定命格')}</h4>
          <span class="alias">${escapeHtml(archetype.alias || '')}</span>
          <p>${escapeHtml(archetype.line || '')}</p>
        </div>
      </div>
      <div class="chart-columns">
        <div class="list-card">
          <h4>天赋与盲区</h4>
          <ul>
            <li>${escapeHtml(archetype.strength || '')}</li>
            <li>${escapeHtml(archetype.blindspot || '')}</li>
            <li>${escapeHtml(archetype.career || '')}</li>
          </ul>
        </div>
        <div class="list-card">
          <h4>关系与助运</h4>
          <ul>
            <li>${escapeHtml(archetype.love || '')}</li>
            <li>助运五行：${escapeHtml(lucky.element || '')} · ${escapeHtml(lucky.color || '')}</li>
            <li>方位 ${escapeHtml(lucky.direction || '')} · 数字 ${escapeHtml(lucky.number || '')}</li>
          </ul>
        </div>
      </div>
      <div class="chart-luck">
        ${safeArray(archetype.traits).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        ${safeArray(profile.missing).length ? `<span class="tag ji">五行缺 ${profile.missing.map((e) => ELEMENTS[e].label).join('、')}</span>` : '<span class="tag yi">五行俱全</span>'}
      </div>
      <div class="result-actions" style="margin-top:18px">
        <button type="button" class="btn btn-primary" data-action="chart-ask">拿这个命格去问判官</button>
      </div>
    </article>
  `;
  box.hidden = false;
  animateMeters(box);
}

function renderDaily(profileInput) {
  const profile = buildProfile(profileInput || getProfile());
  const daily = buildDaily(profile, todayKey());
  const box = $('#dailyResult');
  const bars = daily.details.map((d) => `
    <div class="daily-bar">
      <div class="bar-label"><span><em>${escapeHtml(d.icon)}</em>${escapeHtml(d.label)}</span><b>${d.value}</b></div>
      <div class="meter"><i data-width="${d.value}"></i></div>
      ${d.tip ? `<p class="daily-tip">${escapeHtml(d.tip)}</p>` : ''}
    </div>`).join('');
  box.innerHTML = `
    <article class="daily-card">
      <div class="daily-head">
        <div>
          <span class="daily-date">${escapeHtml(daily.dateLabel)}</span>
          <h3>${escapeHtml(daily.tier.label)} · ${escapeHtml(daily.theme.label)}</h3>
          <p>${escapeHtml(daily.summary)}</p>
        </div>
        <div class="score-ring" style="--p:${daily.overall}">
          <div class="score-ring-inner"><b>${daily.overall}</b><span>今日气运</span></div>
        </div>
      </div>
      <div class="daily-overall">
        <div class="daily-theme">
          <b>${escapeHtml(daily.theme.label)}</b>
          <p>${escapeHtml(daily.theme.line)} · ${escapeHtml(daily.theme.advice)}</p>
        </div>
      </div>
      <div class="daily-bars">${bars}</div>
      <div class="daily-bottom">
        <div class="daily-list">
          <h4>今日宜</h4>
          <div class="tag-row">${daily.yi.map((x) => `<span class="tag yi">${escapeHtml(x)}</span>`).join('')}</div>
        </div>
        <div class="daily-list">
          <h4>今日忌</h4>
          <div class="tag-row">${daily.ji.map((x) => `<span class="tag ji">${escapeHtml(x)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="daily-luck">
        <span>幸运色 <b>${escapeHtml(daily.lucky.color)}</b></span>
        <span>方位 <b>${escapeHtml(daily.lucky.direction)}</b></span>
        <span>数字 <b>${escapeHtml(daily.lucky.number)}</b></span>
        <span>时辰 <b>${escapeHtml(daily.lucky.time)}</b></span>
      </div>
      <p class="micro-note">每日运势由本地玄机引擎按日期与个人签名计算，同一天反复查看结果一致。</p>
    </article>
  `;
  box.hidden = false;
  animateMeters(box);
  state.daily = daily;
  state.dailyDate = todayKey();
}

/* ------------------------------------------------------------------ */
/* 历史与成就                                                         */
/* ------------------------------------------------------------------ */

function pushHistory(type, reading) {
  const item = {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    createdAt: new Date().toISOString(),
    question: type === 'reading' ? reading.question
      : type === 'lot' ? `灵签：${reading.lot.name}`
      : type === 'match' ? `合盘：${reading.names}` : '',
    verdict: type === 'reading' ? reading.answer.verdict
      : type === 'lot' ? `${reading.lot.level} · ${reading.lot.name}`
      : type === 'match' ? `${reading.score} 分 · ${reading.label}` : '',
    reading
  };
  state.history.unshift(item);
  state.history = state.history.slice(0, 24);
  writeStorage(STORE.history, state.history);
  if (type === 'reading' && reading.answer?.domain) {
    state.chatDomain = reading.answer.domain;
  }
  updateLedgerBadge();
  renderHistory();
}

function updateLedgerBadge() {
  $('#ledgerCount').textContent = String(state.history.length);
  const merit = $('#ledgerMerit');
  if (merit) merit.textContent = String(state.merit);
  $('#meritCount').textContent = String(state.merit);
  const stat = $('#statReadings');
  if (stat) stat.textContent = String(state.history.length);
}

const HISTORY_TYPE_LABEL = { reading: '判', match: '缘', lot: '签' };

function renderHistory() {
  const list = $('#historyList');
  if (!list) return;
  const entries = state.history
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => state.ledgerFilter === 'all' || item.type === state.ledgerFilter);
  if (!entries.length) {
    const hint = state.ledgerFilter === 'all'
      ? '还没有判词。去问一卦，这里就有东西了。'
      : '这一类还没有记录。去对应的殿里落一笔。';
    list.innerHTML = `<p class="empty-hint">${hint}</p>`;
    return;
  }
  list.innerHTML = entries.map(({ item, index }) => `
    <div class="history-item" data-history-index="${index}" role="button" tabindex="0" aria-label="查看这条记录">
      <div class="history-question">
        <span class="history-type type-${item.type}">${HISTORY_TYPE_LABEL[item.type] || '记'}</span>
        <span>${escapeHtml(item.question || '一次未命名的问事')}</span>
      </div>
      <div class="history-meta">
        <span>${escapeHtml(formatShortDate(item.createdAt))}</span>
        <span class="history-verdict">${escapeHtml(item.verdict || '')}</span>
      </div>
      <button type="button" class="history-delete" data-delete-index="${index}" aria-label="删除这条记录" title="删除这条记录">×</button>
    </div>
  `).join('');
}

function openHistoryEntry(entry) {
  if (!entry?.reading) return;
  if (entry.type === 'lot' && entry.reading.lot) {
    renderLot(entry.reading);
    pendingScroll = '#lotResult';
    navigate('lot');
  } else if (entry.type === 'match') {
    renderMatch(entry.reading);
    pendingScroll = '#matchResult';
    navigate('match');
  } else if (entry.type === 'reading' && entry.reading.answer) {
    if (entry.reading.mode === 'choice') {
      renderChoiceResult(entry.reading);
      pendingScroll = '#choiceResult';
      navigate('choose');
    } else {
      renderReading(entry.reading);
      pendingScroll = '#resultPanel';
      navigate('ask');
    }
  }
}

function markFlag(key) {
  if (state.flags[key]) return;
  state.flags[key] = true;
  writeStorage(STORE.flags, state.flags);
  checkAchievements();
}

function checkAchievements() {
  let changed = false;
  for (const achievement of ACHIEVEMENTS) {
    if (state.achievements[achievement.key]) continue;
    if (achievement.test()) {
      state.achievements[achievement.key] = true;
      changed = true;
      toast(`判官印记解锁：${achievement.name}`, 'gold');
      playChime('merit');
    }
  }
  if (changed) {
    writeStorage(STORE.achievements, state.achievements);
    renderAchievements();
  }
}

function renderAchievements() {
  const box = $('#achievements');
  if (!box) return;
  box.innerHTML = ACHIEVEMENTS.map((a) => {
    const unlocked = Boolean(state.achievements[a.key]);
    return `<span class="achievement ${unlocked ? 'unlocked' : ''}"><i>${a.icon}</i>${a.name}</span>`;
  }).join('');
}

function addMerit(n = 1) {
  state.merit += n;
  writeStorage(STORE.merit, state.merit);
  updateLedgerBadge();
  checkAchievements();
}

/* ------------------------------------------------------------------ */
/* 复制 / 分享 / 导出                                                 */
/* ------------------------------------------------------------------ */

async function copyText(text, successMessage = '已复制到剪贴板。') {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage, 'gold');
    playTone(660, 0, 0.2, 0.018);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(successMessage, 'gold');
    } catch {
      toast('复制失败，请手动选择文本。', 'bad');
    }
    ta.remove();
  }
}

function readingToText(reading) {
  if (!reading) return '';
  const a = reading.answer;
  return [
    `【天机判官】${reading.question}`,
    `判词：${a.verdict}`,
    reading.headline,
    '',
    ...safeArray(reading.detail),
    '',
    `卦象：${a.hexagram?.name} ${a.hexagram?.judgment}`,
    `应期：${a.timing?.label}（${a.timing?.short}）`,
    `天机码：${reading.signature}`,
    '娱乐性内容，仅供参考。'
  ].join('\n');
}

function lotToText(reading) {
  const lot = reading.lot;
  return [
    `【天机判官 · 二十四节气灵签】${reading.question || ''}`,
    `${lot.level} · ${lot.name}`,
    lot.poem.join('，'),
    lot.oracle,
    '',
    ...safeArray(reading.detail),
    `天机码：${reading.signature}`,
    '娱乐性内容，仅供参考。'
  ].join('\n');
}

function speakReading() {
  const reading = state.currentReading;
  if (!reading) return;
  if (!('speechSynthesis' in window)) {
    toast('这个浏览器不支持朗读，试试复制判词。', 'bad');
    return;
  }
  window.speechSynthesis.cancel();
  const text = `${reading.answer.verdict}。${reading.headline} ${safeArray(reading.detail)[0] || ''} ${safeArray(reading.actions)[0] || ''}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.92;
  utterance.pitch = 0.85;
  window.speechSynthesis.speak(utterance);
  toast('判官开始念判词。', 'gold');
}

async function shareReading() {
  const reading = state.currentReading;
  if (!reading) return;
  const text = readingToText(reading);
  if (navigator.share) {
    try {
      await navigator.share({ title: '天机判词', text });
      markFlag('share');
      return;
    } catch {
      /* 用户取消，走复制 */
    }
  }
  await copyText(text, '分享文案已复制。');
  markFlag('share');
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 8) {
  const chars = [...String(text || '')];
  let line = '';
  let lines = 0;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      lines += 1;
      line = ch;
      if (lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) {
    if (chars.length > [...line].length + 1 && lines === maxLines - 1) {
      line = line.slice(0, -1) + '…';
    }
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function roundedRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function exportReadingImage(reading) {
  if (!reading) return;
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#08080d';
    ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W * 0.8, 0, 0, W * 0.8, 0, W * 0.9);
    bg.addColorStop(0, 'rgba(184,58,48,0.10)');
    bg.addColorStop(1, 'rgba(8,8,13,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(217,179,108,0.34)';
    ctx.lineWidth = 2;
    ctx.strokeRect(34, 34, W - 68, H - 68);
    ctx.strokeStyle = 'rgba(217,179,108,0.12)';
    ctx.strokeRect(48, 48, W - 96, H - 96);

    ctx.fillStyle = '#d9b36c';
    ctx.font = '600 30px "KaiTi","STKaiti",serif';
    ctx.fillText('天机判官', 84, 108);
    ctx.fillStyle = '#918875';
    ctx.font = '14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('GUNCAT ORACLE · 一个答案', 84, 138);
    ctx.textAlign = 'right';
    ctx.fillText(`天机码 ${reading.signature}`, W - 84, 108);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(217,179,108,0.22)';
    ctx.beginPath();
    ctx.moveTo(84, 164);
    ctx.lineTo(W - 84, 164);
    ctx.stroke();

    ctx.fillStyle = '#918875';
    ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(`问：${reading.question}`, 84, 210);
    ctx.fillStyle = '#f0e6d2';
    ctx.font = '600 38px "KaiTi","STKaiti",serif';
    wrapCanvasText(ctx, reading.headline, 84, 270, W - 168, 54, 4);

    // 印章
    const isChoice = reading.mode === 'choice';
    const seal = isChoice ? '选' : reading.answer.verdict;
    ctx.save();
    ctx.translate(84, 430);
    ctx.rotate(-0.06);
    ctx.fillStyle = '#a9322a';
    roundedRect(ctx, 0, 0, 190, 190, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,215,154,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff1d6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${seal.length > 2 ? 52 : 74}px "KaiTi","STKaiti",serif`;
    ctx.fillText(seal, 95, 98);
    ctx.restore();

    ctx.fillStyle = '#f0e6d2';
    ctx.font = '600 30px "KaiTi","STKaiti",serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const detailX = 320;
    let dy = 470;
    const paragraphs = safeArray(reading.detail).slice(0, 2);
    for (const p of paragraphs) {
      ctx.fillStyle = '#cfc3ac';
      ctx.font = '20px "PingFang SC","Microsoft YaHei",sans-serif';
      dy = wrapCanvasText(ctx, p, detailX, dy, W - detailX - 84, 34, 5);
      dy += 14;
    }

    // 判词批语
    ctx.strokeStyle = 'rgba(217,179,108,0.18)';
    ctx.beginPath();
    ctx.moveTo(84, 760);
    ctx.lineTo(W - 84, 760);
    ctx.stroke();
    ctx.fillStyle = '#b83a30';
    ctx.font = '13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('判 官 批 语', 84, 800);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e7d9bd';
    ctx.font = '30px "KaiTi","STKaiti",serif';
    safeArray(reading.poem).forEach((line, i) => {
      ctx.fillText(line, W / 2, 868 + i * 52);
    });

    // 信息条
    const infoY = 1130;
    const a = reading.answer;
    const element = ELEMENTS[a.element] || ELEMENTS.earth;
    const tiles = [
      ['应期', a.timing?.label || '', a.timing?.short || ''],
      ['助运', element.label, element.trait],
      ['方位', reading.lucky?.direction || element.direction, reading.lucky?.color || element.color],
      ['卦象', a.hexagram?.name || '', a.upper?.name && a.lower?.name ? `上${a.upper.name} 下${a.lower.name}` : '']
    ];
    const tileW = (W - 168 - 36) / 4;
    tiles.forEach((tile, i) => {
      const x = 84 + i * (tileW + 12);
      ctx.fillStyle = 'rgba(240,230,210,0.035)';
      roundedRect(ctx, x, infoY, tileW, 112, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(217,179,108,0.16)';
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#6f685b';
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(tile[0], x + 16, infoY + 30);
      ctx.fillStyle = '#f4d79a';
      ctx.font = '600 24px "KaiTi","STKaiti",serif';
      ctx.fillText(tile[1], x + 16, infoY + 64);
      ctx.fillStyle = '#918875';
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(tile[2], x + 16, infoY + 88);
    });

    // 底部
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6f685b';
    ctx.font = '14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('娱乐性内容，不构成医疗、法律、投资等专业建议。', 84, H - 92);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b83a30';
    ctx.font = '600 18px "KaiTi","STKaiti",serif';
    ctx.fillText('天机已定', W - 84, H - 90);
    ctx.textAlign = 'left';

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
    if (!blob) throw new Error('canvas empty');
    const url = URL.createObjectURL(blob);
    const img = $('#imageExport');
    img.src = url;
    $('#imageExportWrap').hidden = false;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tianji-${reading.signature}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    markFlag('share');
    toast('判词图已生成。', 'gold');
  } catch {
    toast('图片生成失败，试试复制判词。', 'bad');
  }
}

/* ------------------------------------------------------------------ */
/* 每日 / 抉择 / 合盘 / 灵签 / 命盘                                   */
/* ------------------------------------------------------------------ */

async function handleDaily(event) {
  if (event) event.preventDefault();
  renderDaily(getProfile());
  playChime('soft');
  addMerit(1);
  toast('今日运势已翻开。', 'gold');
}

function setupDaily() {
  $('#dailyForm').addEventListener('submit', handleDaily);
  $('#dailyNowBtn')?.addEventListener('click', () => {
    renderDaily(getProfile());
    playChime('soft');
  });
}

function setupChoiceArena() {
  $('#arenaAdd').addEventListener('click', () => {
    if (state.extraArenaChoices.length >= 4) {
      toast('最多六个选项，够判官选了。');
      return;
    }
    const index = state.extraArenaChoices.length;
    const letter = String.fromCharCode(67 + index);
    const label = document.createElement('label');
    label.className = 'arena-option';
    label.innerHTML = `<span>${letter}</span><input maxlength="40" placeholder="选项 ${letter}"><button type="button" class="text-btn" aria-label="删除选项">移除</button>`;
    const input = label.querySelector('input');
    label.querySelector('button').addEventListener('click', () => {
      label.remove();
      state.extraArenaChoices = state.extraArenaChoices.filter((x) => x.row !== label);
      state.extraArenaChoices.forEach((item, i) => {
        const l = String.fromCharCode(67 + i);
        item.row.querySelector('span').textContent = l;
        item.input.placeholder = `选项 ${l}`;
      });
    });
    $('#arenaOptions').appendChild(label);
    state.extraArenaChoices.push({ row: label, input });
    input.focus();
  });

  $('#choiceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const question = $('#choiceQuestion').value.trim();
    const options = [$('#arenaA').value, $('#arenaB').value]
      .concat(state.extraArenaChoices.map((x) => x.input.value))
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const unique = [...new Set(options)].slice(0, 6);
    if (!question) {
      toast('先把你的选择题写出来。', 'bad');
      $('#choiceQuestion').focus();
      return;
    }
    if (unique.length < 2) {
      toast('至少写两个选项，判官不投弃权票。', 'bad');
      return;
    }
    const profile = getProfile();
    state.busy = true;
    addMerit(1);
    playChime('start');
    setBusy($('#choiceSubmit'), true);
    const ritual = runRitual();
    const payload = {
      question,
      mode: 'choice',
      options: unique,
      name: profile.name,
      birth: profile.birth,
      time: profile.time,
      gender: profile.gender
    };
    try {
      const data = await api('/api/divine', payload);
      await ritual;
      renderChoiceResult(data.reading);
      pushHistory('reading', data.reading);
      checkAchievements();
      playChime('success');
      scrollToEl($('#choiceResult'));
    } catch {
      await ritual;
      const data = localDivine(payload);
      renderChoiceResult(data.reading);
      pushHistory('reading', data.reading);
      checkAchievements();
      playChime('success');
      toast('模型没接上，本地玄机替你选了。', 'gold');
      scrollToEl($('#choiceResult'));
    } finally {
      state.busy = false;
      setBusy($('#choiceSubmit'), false);
    }
  });
}

function setupMatch() {
  $('#matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const aName = $('#matchAName').value.trim();
    const bName = $('#matchBName').value.trim();
    const aBirth = $('#matchABirth').value;
    const bBirth = $('#matchBBirth').value;
    const aTime = $('#matchATime').value;
    const bTime = $('#matchBTime').value;
    if (!aName || !bName) {
      toast('两个人的名字都要写，判官才好点名。', 'bad');
      return;
    }
    state.busy = true;
    addMerit(1);
    playChime('start');
    setBusy($('#matchSubmit'), true);
    const ritual = runRitual();
    const finish = (reading, offline) => {
      renderMatch(reading);
      pushHistory('match', reading);
      markFlag('match');
      checkAchievements();
      playChime('success');
      if (offline) toast('模型没接上，本地玄机合了这盘。', 'gold');
      scrollToEl($('#matchResult'));
    };
    try {
      const data = await api('/api/match', { aName, aBirth, aTime, bName, bBirth, bTime });
      await ritual;
      finish(data.reading, false);
    } catch {
      await ritual;
      const data = localMatch(aName, aBirth, aTime, bName, bBirth, bTime);
      finish(data.reading, true);
    } finally {
      state.busy = false;
      setBusy($('#matchSubmit'), false);
    }
  });
}

function setupLot() {
  $('#lotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const question = $('#lotQuestion').value.trim() || '我近期的整体运势如何？';
    const profile = getProfile();
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.busy = true;
    addMerit(1);
    playChime('start');
    setBusy($('#lotSubmit'), true);
    const bundle = $('#lotBundle');
    bundle.classList.add('shaking');
    await sleep(950);
    bundle.classList.remove('shaking');
    const ritual = runRitual();
    const payload = { question, name: profile.name, birth: profile.birth, nonce };
    try {
      const data = await api('/api/draw', payload);
      await ritual;
      renderLot(data.reading);
      pushHistory('lot', data.reading);
      markFlag('lot');
      checkAchievements();
      playChime('success');
      scrollToEl($('#lotResult'));
    } catch {
      await ritual;
      const data = localLot(payload);
      renderLot(data.reading);
      pushHistory('lot', data.reading);
      markFlag('lot');
      checkAchievements();
      playChime('success');
      toast('模型没接上，本地玄机替你摇了这支签。', 'gold');
      scrollToEl($('#lotResult'));
    } finally {
      state.busy = false;
      setBusy($('#lotSubmit'), false);
    }
  });
}

function setupChart() {
  $('#chartForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = getProfile();
    if (!input.birth) {
      toast('出生日期是排盘的底线，先填一下。', 'bad');
      $('#chartBirth').focus();
      return;
    }
    const profile = buildProfile(input);
    renderChart(profile);
    markFlag('chart');
    addMerit(1);
    playChime('soft');
    scrollToEl($('#chartResult'));
  });
}

/* ------------------------------------------------------------------ */
/* 判官问答                                                           */
/* ------------------------------------------------------------------ */

function appendChatBubble(role, content, extra = '') {
  const box = $('#chatMessages');
  const el = document.createElement('div');
  el.className = `chat-bubble ${role}`;
  el.innerHTML = `${role === 'assistant' && extra ? `<span class="bubble-verdict">${escapeHtml(extra)}</span>` : ''}<p>${escapeHtml(content)}</p><span class="bubble-time">${nowTime()}</span>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function appendTyping() {
  const box = $('#chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-bubble assistant typing';
  el.innerHTML = '<p class="typing-dots"><i></i><i></i><i></i></p>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function chatProfilePayload() {
  const p = getProfile();
  return { name: p.name, birth: p.birth, time: p.time, gender: p.gender };
}

function trimChat() {
  if (state.chat.length > 12) state.chat = state.chat.slice(-12);
}

function appendReadingBubble(reading, local = false) {
  const reply = reading.chatReply;
  appendChatBubble('assistant', reply, reading.mode === 'choice' ? '选' : reading.answer.verdict);
  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  meta.innerHTML = local
    ? `<span>本地玄机</span><span>${escapeHtml(reading.answer.hexagram?.name || '')}</span><span>把握 ${Math.round(reading.answer.confidence || 0)}%</span>`
    : `<span>${escapeHtml(reading.answer.domainLabel)}</span><span>${escapeHtml(reading.answer.hexagram?.name || '')}</span><span>把握 ${Math.round(reading.answer.confidence || 0)}%</span>`;
  $('#chatMessages').lastElementChild?.appendChild(meta);
  state.chat.push({ role: 'assistant', content: reply });
  if (reading.answer?.domain) state.chatDomain = reading.answer.domain;
  markFlag('chat');
  playChime('success');
  $('#chatInput').value = '';
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

async function sendChat(raw) {
  const question = String(raw || '').trim();
  if (!question || state.busy) return;
  state.busy = true;
  addMerit(1);
  playChime('soft');
  appendChatBubble('user', question);
  state.chat.push({ role: 'user', content: question });

  // 闲聊意图：本地直接应答，不耗模型配额。
  if (matchSmalltalk(question)) {
    const typing = appendTyping();
    await sleep(420 + Math.random() * 380);
    typing.remove();
    const reply = smalltalkReply(question, String(state.chat.length)) || '判官在。把具体的问题放上来。';
    appendChatBubble('assistant', reply);
    state.chat.push({ role: 'assistant', content: reply });
    markFlag('chat');
    playChime('soft');
    $('#chatInput').value = '';
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
    state.busy = false;
    trimChat();
    return;
  }

  const typing = appendTyping();
  const payload = {
    question,
    mode: 'verdict',
    ...chatProfilePayload(),
    contextDomain: state.chatDomain || '',
    chatContext: state.chat.slice(-6)
  };
  try {
    const data = await api('/api/divine', payload);
    typing.remove();
    appendReadingBubble(data.reading);
  } catch {
    typing.remove();
    const data = localDivine(payload);
    appendReadingBubble(data.reading, true);
  } finally {
    state.busy = false;
    trimChat();
  }
}

function setupChat() {
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('#chatInput').value);
  });
  $('#chatQuick').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    sendChat(btn.textContent);
  });
}

/* ------------------------------------------------------------------ */
/* 事件代理                                                           */
/* ------------------------------------------------------------------ */

function setupActions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'copy-reading') {
      copyText(readingToText(state.currentReading), '判词已复制。');
    } else if (action === 'speak-reading') {
      speakReading();
    } else if (action === 'share-reading') {
      shareReading();
    } else if (action === 'save-reading') {
      exportReadingImage(state.currentReading);
    } else if (action === 'again') {
      $('#questionInput').value = '';
      updateCharCount();
      navigate('ask');
      setTimeout(() => $('#questionInput').focus(), 300);
    } else if (action === 'open-choice-result') {
      if (state.choiceReading) {
        renderReading(state.choiceReading);
        pendingScroll = '#resultPanel';
        navigate('ask');
      }
    } else if (action === 'copy-choice') {
      if (state.choiceReading) copyText(readingToText(state.choiceReading), '结论已复制。');
    } else if (action === 'match-reset') {
      $('#matchResult').hidden = true;
      $('#matchForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (action === 'copy-match') {
      const reading = state.matchReading;
      if (reading) {
        copyText([
          `【天机判官 · 合盘】${reading.names}`,
          `契合指数：${reading.score} · ${reading.label}`,
          reading.headline,
          ...safeArray(reading.detail),
          `天机码：${reading.signature}`
        ].join('\n'), '合盘已复制。');
      }
    } else if (action === 'lot-again') {
      $('#lotQuestion').value = '';
      $('#lotQuestion').focus();
      scrollToEl($('#lotForm'));
    } else if (action === 'copy-lot') {
      if (state.currentLot) copyText(lotToText(state.currentLot), '签文已复制。');
    } else if (action === 'chart-ask') {
      const p = state.chartProfile || buildProfile(getProfile());
      const name = p?.name ? `${p.name}的` : '我的';
      setMode('score', { question: `${name}命格适合往哪个方向发展？` });
      navigate('ask');
      setTimeout(() => $('#questionInput').focus(), 300);
    }
  });

  $('#imageExportClose').addEventListener('click', () => {
    $('#imageExportWrap').hidden = true;
    const img = $('#imageExport');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
  });
}

/* ------------------------------------------------------------------ */
/* 导航 / 香火簿 / 点香                                               */
/* ------------------------------------------------------------------ */

function scrollToEl(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupNavigation() {
  const header = $('#siteHeader');
  const menuBtn = $('#menuBtn');
  const nav = $('#mainNav');

  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 24);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      nav.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('open')) return;
    if (nav.contains(e.target) || menuBtn.contains(e.target)) return;
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  });
}

function setupLedger() {
  $('#ledgerFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.ledgerFilter = btn.dataset.filter;
    $$('#ledgerFilters button').forEach((b) => b.classList.toggle('active', b === btn));
    renderHistory();
    playTone(500, 0, 0.15, 0.012);
  });

  const historyList = $('#historyList');
  historyList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete-index]');
    if (del) {
      e.stopPropagation();
      const index = Number(del.dataset.deleteIndex);
      const [removed] = state.history.splice(index, 1);
      writeStorage(STORE.history, state.history);
      updateLedgerBadge();
      renderHistory();
      if (removed) toast('已删去这一笔。');
      return;
    }
    const item = e.target.closest('[data-history-index]');
    if (!item) return;
    const entry = state.history[Number(item.dataset.historyIndex)];
    if (entry) openHistoryEntry(entry);
  });
  historyList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('[data-history-index]');
    if (!item || e.target.closest('[data-delete-index]')) return;
    e.preventDefault();
    const entry = state.history[Number(item.dataset.historyIndex)];
    if (entry) openHistoryEntry(entry);
  });

  $('#clearHistory').addEventListener('click', () => {
    if (!state.history.length) return;
    if (window.confirm('确定清空香火簿里的全部判词吗？')) {
      state.history = [];
      writeStorage(STORE.history, state.history);
      updateLedgerBadge();
      renderHistory();
      toast('香火簿已清空。');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#imageExportWrap').hidden = true;
    }
  });

  $('#incenseBtn').addEventListener('click', () => {
    addMerit(1);
    playChime('merit');
    toast('功德 +1。判官记下了。', 'gold');
  });
}

/* ------------------------------------------------------------------ */
/* 星空背景                                                           */
/* ------------------------------------------------------------------ */

function setupStarfield() {
  const canvas = $('#starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let stars = [];
  let raf = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(150, Math.floor((width * height) / 12000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.25 + 0.25,
      a: Math.random() * 0.5 + 0.1,
      speed: Math.random() * 0.05 + 0.01,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function draw(t = 0) {
    ctx.clearRect(0, 0, width, height);
    for (const star of stars) {
      const twinkle = 0.55 + Math.sin(t * 0.001 + star.phase) * 0.45;
      ctx.beginPath();
      ctx.fillStyle = `rgba(230, 215, 180, ${star.a * twinkle})`;
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
      if (!reduced) {
        star.y -= star.speed;
        if (star.y < -2) {
          star.y = height + 2;
          star.x = Math.random() * width;
        }
      }
    }
    if (!reduced) raf = requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    resize();
    draw();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (!reduced) {
      raf = requestAnimationFrame(draw);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 初始化                                                             */
/* ------------------------------------------------------------------ */

function init() {
  $('#yearNow').textContent = String(new Date().getFullYear());

  state.profile = (() => {
    const raw = readStorage(STORE.profile, null);
    if (!raw || typeof raw !== 'object') return null;
    const clean = cleanProfile(raw);
    return isEmptyIdentity(clean) ? null : clean;
  })();
  state.partner = (() => {
    const raw = readStorage(STORE.partner, null);
    if (!raw || typeof raw !== 'object') return null;
    const clean = {
      name: String(raw.name || '').trim().slice(0, 24),
      birth: /^\d{4}-\d{2}-\d{2}$/.test(raw.birth || '') ? raw.birth : '',
      time: /^\d{1,2}:\d{2}$/.test(raw.time || '') ? raw.time : ''
    };
    return (clean.name || clean.birth || clean.time) ? clean : null;
  })();

  initDateLimits();
  setupSound();
  setupIdentityBinding();
  setupProfilePage();
  setupNavigation();
  setupLedger();
  setupActions();
  setupDaily();
  setupChoiceArena();
  setupMatch();
  setupLot();
  setupChart();
  setupChat();
  setupStarfield();
  renderExamples();
  renderAchievements();
  updateLedgerBadge();
  syncProfileUI();
  syncPartnerUI();
  updateOnlineUI();

  $('#questionInput').addEventListener('input', updateCharCount);
  updateCharCount();

  $$('.mode-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  $('#addChoiceBtn').addEventListener('click', () => addAskChoice());
  $('#askForm').addEventListener('submit', handleAskSubmit);

  // 会话异步建立，不阻塞首屏。
  initSession();

  // 键盘：Ctrl/Cmd + Enter 直接落笔
  $('#questionInput').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      $('#askForm').requestSubmit();
    }
  });
  $('#chatInput').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      $('#chatForm').requestSubmit();
    }
  });

  // 路由最后初始化：按当前 hash 落到对应的殿。
  setupRouter();

  // 首次访问的轻提示
  if (!state.history.length && state.route === 'home') {
    setTimeout(() => toast('判官已就位。挑一座殿进去，问一个具体的问题。', 'gold'), 1400);
  }
}

init();