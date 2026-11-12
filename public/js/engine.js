/* 天机判官 · 共享玄机引擎
 * 纯前端可运行、服务端也可复用。所有判词均为娱乐性内容。
 */

import {
  DOMAINS, DOMAIN_ORDER, ELEMENTS, ELEMENT_ORDER, ELEMENT_CRITERIA,
  STEMS, BRANCHES, STEM_ELEMENTS, BRANCH_ELEMENTS, ZODIAC,
  TRIGRAMS, TRIGRAM_ORDER, TRIGRAM_CRITERIA, HEXAGRAM_BY_PAIR,
  FORTUNE_TIERS, FORTUNE_SCALE, TIMING_OPTIONS, TIMING_CRITERIA,
  ADVICE_THEMES, ADVICE_CRITERIA, POEMS, LOTS, DAILY_THEMES,
  YI_ACTIVITIES, JI_ACTIVITIES, ARCHETYPES, CLOSERS, OUTCOME_LINES,
  SMALLTALK, SMALLTALK_ORDER, WHEN_LINES, WHY_LINES, HOW_LINES,
  FOLLOWUP_ACK, CHAT_OPENERS, DAILY_TIPS
} from './data.js?v=16';

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function mod(n, m) {
  return ((n % m) + m) % m;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(...parts) {
  const seed = parts.filter((p) => p !== undefined && p !== null).join('|');
  return mulberry32(xmur3(seed)());
}

export function pick(rng, arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function sampleUnique(rng, arr, count) {
  const copy = [...new Set((arr || []).filter(Boolean))];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

export function signatureFor(...parts) {
  return hashString(parts.join('|')).slice(0, 6).toUpperCase();
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateCN(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 星期${week}`;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* 问题解析                                                           */
/* ------------------------------------------------------------------ */

const POSITIVE_WORDS = ['想', '希望', '期待', '喜欢', '爱', '机会', '成功', '上岸', '拿到', '升职', '加薪', '复合', '和好', '顺利', '值得', '适合', '能', '可以', '会', '录取', '通过', '转正', '脱单', '中奖', '回本', '盈利', '好转', '康复', '稳定', '靠谱', '心动', '双向', '回应', '主动', '贵人', '突破', '翻盘', '逆袭', '准备好了', '打算', '决定'];
const NEGATIVE_WORDS = ['怕', '担心', '焦虑', '失败', '分手', '离职', '辞职', '亏', '拒绝', '被拒', '失去', '错过', '生病', '吵架', '冷战', '拖', '不敢', '不确定', '迷茫', '纠结', '被裁', '失业', '离开', '被骗', '背叛', '出轨', '拉黑', '删除', '断联', '黄了', '崩了', '挂科', '落榜', '延期', '罚款', '倒闭', '负债', '逾期', '失眠', '崩溃', '内耗', '消耗', '委屈', '不甘心', '没底', '慌', '来不及', '太晚', '没戏', '悬', '凉了'];

function sentimentScore(q) {
  let score = 0;
  for (const w of POSITIVE_WORDS) if (q.includes(w)) score += 1;
  for (const w of NEGATIVE_WORDS) if (q.includes(w)) score -= 1;
  return clamp(score, -3, 3);
}

function cleanOption(raw) {
  return String(raw || '')
    .replace(/[？?。！!，,]/g, ' ')
    .replace(/^(我|我们|是|该|应该|要不要|选|选择|去|做|要)\s*/g, '')
    .replace(/\s*(好|呢|吧|啊|吗|呀)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractChoices(question) {
  const q = String(question || '').replace(/[？?]/g, '');
  const parts = q.split(/\s*(?:还是|或者|or|OR|VS|vs|、)\s*/).map(cleanOption).filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length >= 2) return unique.slice(0, 6);
  const m = q.match(/(?:选|选择)\s*(.+?)\s*(?:好|呢|？|$)/);
  if (m) {
    const single = m[1].split(/[和与及]/).map(cleanOption).filter(Boolean);
    if (single.length >= 2) return single.slice(0, 6);
  }
  return [];
}

function buildProposition(question, kind, negativeEvent) {
  const q = question;
  if (kind === 'choice') {
    return { text: '问题中的某个选项会明显优于其他选项', yes: '就选它', no: '先别选' };
  }
  if (kind === 'when' || kind === 'why' || kind === 'how') {
    return { text: '这件事整体朝有利方向发展', yes: '向好', no: '走弱' };
  }
  if (/值不值得|值得/.test(q)) return { text: '问题中提到的这件事值得投入', yes: '值得', no: '不值得' };
  if (/该不该|要不要|是否应该|应不应该|适不适合/.test(q)) {
    return { text: '问卜者应当推进问题中提到的这件事', yes: '该', no: '不该' };
  }
  if (/喜欢/.test(q)) return { text: '对方喜欢问卜者', yes: '喜欢', no: '不喜欢' };
  if (/爱/.test(q)) return { text: '对方爱问卜者', yes: '爱', no: '不爱' };
  if (/在乎|在意/.test(q)) return { text: '对方在乎问卜者', yes: '在乎', no: '不在乎' };
  if (/复合|和好/.test(q)) return { text: '对方愿意与问卜者复合', yes: '会', no: '不会' };
  if (/结婚|嫁|娶/.test(q)) return { text: '对方愿意与问卜者进入婚姻', yes: '会', no: '不会' };
  if (/联系|找我|回复|消息/.test(q) && /(会|能|主动)/.test(q)) {
    return { text: '对方会主动联系问卜者', yes: '会', no: '不会' };
  }
  if (/能不能|可不可以|能否|可不可能|能.*[吗嘛]|可以.*[吗嘛]/.test(q)) {
    return { text: '问卜者能够做成问题中提到的这件事', yes: '能', no: '不能' };
  }
  if (/会不会|是否会/.test(q)) {
    if (negativeEvent) return { text: '问题中担心的负面结果不会发生', yes: '不会', no: '会' };
    return { text: '问题中期待的事情会发生', yes: '会', no: '不会' };
  }
  if (/有没有|是否有/.test(q)) return { text: '问题中的条件或对象是存在的', yes: '有', no: '没有' };
  if (/是不是|是否算/.test(q)) return { text: '问题中的判断成立', yes: '是', no: '不是' };
  if (/会.*[吗嘛]?$|还会/.test(q)) {
    if (negativeEvent) return { text: '问题中担心的负面结果不会发生', yes: '不会', no: '会' };
    return { text: '问题中期待的事情会发生', yes: '会', no: '不会' };
  }
  return { text: '这件事整体朝有利方向发展', yes: '向好', no: '走弱' };
}

function countOccurrences(haystack, needle) {
  let idx = 0;
  let count = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += Math.max(1, needle.length);
  }
  return count;
}

function scoreDomain(lower, keywords, weight, lengthBonus) {
  let score = 0;
  for (const kw of keywords || []) {
    if (!kw) continue;
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    const count = countOccurrences(lower, k);
    if (count) score += count * (weight + Math.min(k.length, 6) * lengthBonus);
  }
  return score;
}

export function analyzeQuestion(question, options = [], context = {}) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();
  let domain = 'decision';
  let best = 0;
  for (const key of DOMAIN_ORDER) {
    const d = DOMAINS[key];
    const score = scoreDomain(lower, d.core, 3, 0.4) + scoreDomain(lower, d.keywords, 1, 0.2);
    if (score > best) {
      best = score;
      domain = key;
    }
  }

  const contextDomain = context && DOMAINS[context.domain] ? context.domain : '';
  // 纯意图短句（「那怎么办」「为什么会这样」）不带领域词，应继承上一轮领域，
  // 否则会被 decision 域的通用词（该怎么办/要不要）抢走。
  const bareIntent = /^(那|那么|所以|然后|接着|再|还有)?(该怎么办|怎么办|怎么破|怎么解决|如何是好|为什么|为何|为啥|怎么会这样|什么时候|何时|多久|会不会|能不能|可不可以|要不要|该不该|行不行|好不好|是不是|有没有|值不值)[？?！!。．~～呀啊呢吗]*$/.test(q);
  const followUp = Boolean(contextDomain) && (best === 0 || bareIntent);
  if (followUp) domain = contextDomain;

  const validOptions = (options || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6);
  const choicePattern = /(还是|或者|哪个|哪一个|选哪|二选一|vs\.?|or\s)/i;
  let kind = validOptions.length >= 2 || choicePattern.test(q) ? 'choice' : 'open';
  if (kind !== 'choice' && /(该不该|要不要|是否应该|应不应该|适不适合|值不值得|能不能|可不可以|能否|会不会|有没有|是不是|可不可能|是否值得|对不对|行不行|好不好|要不要去|能不能去)/.test(q)) {
    kind = 'yesno';
  }
  if (kind === 'open' && /(什么时候|何时|多久|几时|哪天|哪个月|哪年|应期|什么时间|多长时间|还要等|等多久|啥时候)/.test(q)) {
    kind = 'when';
  }
  if (kind === 'open' && /(为什么|为何|为啥|怎么会|什么原因|啥原因|凭什么|原因是什么|怎么会这样|怎么就)/.test(q)) {
    kind = 'why';
  }
  if (kind === 'open' && /(怎么办|怎么做|如何|怎样才|怎么才能|怎么破|怎么解决|有什么办法|有什么建议|怎么弄|咋办|咋整|怎么改善|如何改善|怎么挽回|如何挽回|该怎么|怎样破|如何破)/.test(q)) {
    kind = 'how';
  }
  if (kind === 'open' && /[吗嘛][？?]?$/.test(q)) kind = 'yesno';

  const negativeEvent = /(分手|离婚|失败|被拒|拒绝|失业|裁员|亏|生病|吵架|分开|离开|失去|错过|崩|黄了|挂科|落榜|倒闭|被裁|背叛|误会|冷战|结束|退学|延期|罚款|拉黑|删除|断联|出轨|被骗|逾期|负债|恶化|复发|转移|变心|冷淡|敷衍|已读不回|不理我|骗我|坑我|穿小鞋|背锅|优化|毕业|向社会输送)/.test(q);
  const choices = validOptions.length >= 2 ? validOptions : (kind === 'choice' ? extractChoices(q) : []);
  if (kind === 'choice' && choices.length < 2) kind = 'open';

  return {
    question: q,
    domain,
    domainLabel: DOMAINS[domain].label,
    kind,
    followUp,
    negativeEvent,
    proposition: buildProposition(q, kind, negativeEvent),
    choices,
    sentiment: sentimentScore(q)
  };
}

/* ------------------------------------------------------------------ */
/* 闲聊意图（客户端直接应答，不耗模型配额）                            */
/* ------------------------------------------------------------------ */

export function matchSmalltalk(text) {
  const q = String(text || '').trim();
  if (!q || q.length > 60) return null;
  for (const key of SMALLTALK_ORDER) {
    const intent = SMALLTALK[key];
    if (intent && intent.patterns.test(q)) return key;
  }
  return null;
}

export function smalltalkReply(text, seedExtra = '') {
  const key = matchSmalltalk(text);
  if (!key) return null;
  const rng = rngFrom('smalltalk-v1', key, String(text || '').trim(), todayKey(), seedExtra);
  return pick(rng, SMALLTALK[key].replies);
}

/* ------------------------------------------------------------------ */
/* 简化排盘                                                           */
/* ------------------------------------------------------------------ */

function parseBirth(birth) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birth || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1901 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return { h, m: mm };
}

function julianDay(y, m, d) {
  let yy = y;
  let mm = m;
  if (mm <= 2) {
    yy -= 1;
    mm += 12;
  }
  const a = Math.floor(yy / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + d + b - 1524;
}

function pillar(stem, branch) {
  return {
    stem,
    branch,
    text: `${STEMS[stem]}${BRANCHES[branch]}`,
    stemElement: STEM_ELEMENTS[stem],
    branchElement: BRANCH_ELEMENTS[branch]
  };
}

export function computeBazi({ name = '', birth = '', time = '', gender = '' } = {}) {
  const date = parseBirth(birth);
  if (!date) {
    return {
      valid: false,
      name,
      gender,
      birth,
      time,
      timeKnown: false,
      signature: signatureFor(name || 'guest', birth || 'no-birth'),
      zodiac: '',
      pillars: [],
      elementCounts: Object.fromEntries(ELEMENT_ORDER.map((e) => [e, 0])),
      elementScores: Object.fromEntries(ELEMENT_ORDER.map((e) => [e, 20])),
      strongest: 'earth',
      weakest: 'water',
      missing: [],
      favorableElement: 'earth',
      dayMaster: null,
      archetype: null,
      summary: '未录入完整生辰，本局按问事时辰起卦。'
    };
  }

  const t = parseTime(time);
  const { y, m, d } = date;
  const hour = t ? t.h : 12;

  const solarYear = m < 2 || (m === 2 && d < 4) ? y - 1 : y;
  const yearIndex = mod(solarYear - 4, 60);
  const yearStem = yearIndex % 10;
  const yearBranch = yearIndex % 12;

  const monthStarts = [5, 4, 5, 4, 5, 5, 7, 7, 7, 8, 7, 7];
  let mIdx = m - 1;
  if (d < monthStarts[mIdx]) mIdx = mod(mIdx - 1, 12);
  const monthBranch = (mIdx + 1) % 12;
  const monthStem = mod([2, 4, 6, 8, 0][yearStem % 5] + mod(monthBranch - 2, 12), 10);

  let jd = julianDay(y, m, d);
  if (t && t.h >= 23) jd += 1;
  const dayIndex = mod(jd + 49, 60);
  const dayStem = dayIndex % 10;
  const dayBranch = dayIndex % 12;

  const hourBranch = Math.floor((hour + 1) / 2) % 12;
  const hourStem = mod([0, 2, 4, 6, 8][dayStem % 5] + hourBranch, 10);

  const pillars = [
    { key: 'year', label: '年柱', ...pillar(yearStem, yearBranch) },
    { key: 'month', label: '月柱', ...pillar(monthStem, monthBranch) },
    { key: 'day', label: '日柱', ...pillar(dayStem, dayBranch) }
  ];
  if (t) pillars.push({ key: 'hour', label: '时柱', ...pillar(hourStem, hourBranch) });

  const counts = Object.fromEntries(ELEMENT_ORDER.map((e) => [e, 0]));
  for (const p of pillars) {
    counts[p.stemElement] += 1;
    counts[p.branchElement] += 1;
    if (p.key === 'month') counts[p.branchElement] += 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const scores = Object.fromEntries(ELEMENT_ORDER.map((e) => [e, Math.round((counts[e] / total) * 100)]));
  const sorted = [...ELEMENT_ORDER].sort((a, b) => counts[b] - counts[a] || ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b));
  const strongest = sorted[0];
  const weakest = [...sorted].reverse()[0];
  const missing = ELEMENT_ORDER.filter((e) => counts[e] === 0);
  const dayElement = STEM_ELEMENTS[dayStem];
  const polarity = dayStem % 2 === 0 ? 'yang' : 'yin';
  const archetype = ARCHETYPES[`${dayElement}-${polarity}`] || null;
  const favorableElement = weakest;
  const el = ELEMENTS[favorableElement];
  const dayEl = ELEMENTS[dayElement];

  return {
    valid: true,
    name: String(name || '').trim(),
    gender,
    birth,
    time: t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` : '',
    timeKnown: Boolean(t),
    signature: signatureFor(name || 'guest', birth, time || 'unknown'),
    zodiac: ZODIAC[yearBranch],
    pillars,
    dayMaster: {
      stem: STEMS[dayStem],
      element: dayElement,
      elementLabel: dayEl.label,
      polarity,
      label: `${STEMS[dayStem]}${dayEl.label}`
    },
    elementCounts: counts,
    elementScores: scores,
    strongest,
    weakest,
    missing,
    favorableElement,
    lucky: {
      element: el.label,
      color: el.color,
      number: el.number,
      direction: el.direction,
      season: el.season
    },
    archetype,
    summary: `日主${STEMS[dayStem]}${dayEl.label}，${dayEl.trait}。五行${ELEMENTS[strongest].label}旺、${ELEMENTS[weakest].label}弱${missing.length ? `，缺${missing.map((e) => ELEMENTS[e].label).join('、')}` : ''}。`
  };
}

export function buildProfile(input = {}) {
  const bazi = computeBazi(input);
  if (!bazi.valid) {
    const rng = rngFrom('guest', input.name || '', input.birth || '');
    const fav = pick(rng, ELEMENT_ORDER);
    return {
      ...bazi,
      favorableElement: fav,
      elementScores: Object.fromEntries(ELEMENT_ORDER.map((e) => [e, e === fav ? 38 : 15])),
      summary: '未录入完整生辰，本局按问事时辰起卦，五行以问事当下为准。'
    };
  }
  return bazi;
}

/* ------------------------------------------------------------------ */
/* 每日运势                                                           */
/* ------------------------------------------------------------------ */

export function tierForScore(score) {
  let tier = FORTUNE_TIERS[0];
  for (const t of FORTUNE_TIERS) if (score >= t.min) tier = t;
  return tier;
}

const DAILY_DIMENSIONS = [
  { key: 'career', label: '事业', icon: '印' },
  { key: 'love', label: '感情', icon: '缘' },
  { key: 'wealth', label: '财运', icon: '财' },
  { key: 'study', label: '学业', icon: '卷' },
  { key: 'health', label: '健康', icon: '养' },
  { key: 'social', label: '人际', icon: '合' }
];

const LUCKY_TIMES = ['卯时 05:00-07:00', '辰时 07:00-09:00', '巳时 09:00-11:00', '午时 11:00-13:00', '未时 13:00-15:00', '酉时 17:00-19:00', '戌时 19:00-21:00'];

export function buildDaily(profile, dateStr = todayKey()) {
  const sig = profile?.signature || 'guest';
  const rng = rngFrom('daily', sig, dateStr);
  const scores = {};
  const details = [];
  for (const dim of DAILY_DIMENSIONS) {
    const base = 38 + Math.floor(rng() * 58);
    const elementBonus = profile?.valid ? clamp(Math.round((profile.elementScores?.[profile.favorableElement] || 0) * 0.12), -4, 6) : 0;
    const value = clamp(base + elementBonus, 22, 98);
    scores[dim.key] = value;
    const tips = DAILY_TIPS[dim.key] || [];
    details.push({ ...dim, value, tip: tips.length ? pick(rng, tips) : '' });
  }
  const overall = Math.round(details.reduce((sum, d) => sum + d.value, 0) / details.length);
  const tier = tierForScore(overall);
  const theme = pick(rng, DAILY_THEMES);
  const yi = sampleUnique(rng, YI_ACTIVITIES, 3);
  const ji = sampleUnique(rng, JI_ACTIVITIES, 2);
  const fav = profile?.favorableElement || pick(rng, ELEMENT_ORDER);
  const el = ELEMENTS[fav];
  const luckyTime = pick(rng, LUCKY_TIMES);
  const luckyNumber = 1 + Math.floor(rng() * 9);

  return {
    date: dateStr,
    dateLabel: formatDateCN(dateStr),
    overall,
    tier,
    theme,
    scores,
    details,
    headline: `${tier.label}。${theme.line}`,
    summary: `今日主旋律是「${theme.label}」。${theme.advice} 整体气运${tier.label}，按自己的节奏走。`,
    yi,
    ji,
    lucky: {
      element: el.label,
      color: el.color,
      number: luckyNumber,
      direction: el.direction,
      time: luckyTime
    },
    signature: signatureFor('daily', sig, dateStr).slice(0, 6)
  };
}

/* ------------------------------------------------------------------ */
/* 本地决策（模型不可用时的确定性兜底）                                */
/* ------------------------------------------------------------------ */

function makeOptionWeights(rng, options) {
  const raw = options.map(() => 0.25 + rng());
  const total = raw.reduce((a, b) => a + b, 0);
  const probs = raw.map((x) => x / total);
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  return {
    pick: options[best],
    optionProbabilities: options.map((label, i) => ({ label, probability: Math.round(probs[i] * 1000) / 1000 }))
  };
}

export function buildLocalDecision(input, profile, analysisInput) {
  const analysis = analysisInput || analyzeQuestion(input.question, input.options);
  const q = analysis.question;
  const options = analysis.choices.length >= 2 ? analysis.choices : (input.options || []).filter(Boolean);
  const rng = rngFrom('local-v1', q, profile?.signature || input.name || '', todayKey(), input.mode || 'verdict', options.join('|'), input.nonce || '');
  const sentiment = analysis.sentiment || 0;
  let p = 0.5 + (rng() - 0.5) * 0.46 + sentiment * 0.035;
  if (/不想|不要|不该|害怕|担心|不敢/.test(q)) p -= 0.08;
  if (/想|希望|期待|准备|打算|决定/.test(q)) p += 0.05;
  p = clamp(p, 0.07, 0.93);

  let fortune;
  if (input.mode === 'score') {
    fortune = clamp(Math.round(22 + p * 62 + rng() * 16), 12, 98);
  } else if (input.mode === 'choice') {
    fortune = clamp(Math.round(45 + rng() * 48), 30, 96);
  } else {
    fortune = clamp(Math.round(15 + p * 76 + (rng() - 0.5) * 12), 10, 98);
  }

  const timingWeights = ['now', 'week', 'month', 'quarter', 'half', 'year', 'wait'];
  const timingKey = p > 0.7
    ? pick(rng, ['now', 'now', 'week', 'week', 'month', 'quarter'])
    : p < 0.35
      ? pick(rng, ['wait', 'wait', 'wait', 'month', 'quarter'])
      : pick(rng, timingWeights);

  const adviceKeys = Object.keys(ADVICE_THEMES);
  const domainAdvice = {
    career: ['act', 'move', 'learn', 'ask', 'wait'],
    love: ['talk', 'cut', 'wait', 'ask', 'ritual'],
    wealth: ['guard', 'learn', 'wait', 'invest'],
    study: ['learn', 'act', 'ask', 'rest'],
    health: ['rest', 'professional', 'rest', 'guard'],
    social: ['talk', 'cut', 'ask', 'guard'],
    family: ['talk', 'guard', 'wait', 'ritual'],
    travel: ['move', 'act', 'wait', 'guard'],
    spiritual: ['ritual', 'rest', 'act', 'wait'],
    decision: ['act', 'wait', 'learn', 'cut']
  };
  let adviceKey = pick(rng, domainAdvice[analysis.domain] || adviceKeys);
  if (analysis.kind === 'how' && p >= 0.5) adviceKey = pick(rng, ['act', 'talk', 'move', 'learn']);
  if (analysis.kind === 'when' && p < 0.4) adviceKey = 'wait';

  const d = DOMAINS[analysis.domain];
  const lowerPool = TRIGRAM_ORDER.filter((k) => TRIGRAMS[k].element === d.element);
  const lower = pick(rng, lowerPool.length ? lowerPool : TRIGRAM_ORDER);
  const upper = pick(rng, TRIGRAM_ORDER);
  const element = profile?.favorableElement || pick(rng, ELEMENT_ORDER);
  const choice = options.length >= 2 ? makeOptionWeights(rng, options) : null;

  return {
    source: 'local',
    model: 'local-oracle-v1',
    outcomeP: p,
    fortune,
    confidence: Math.round(60 + rng() * 34),
    timing: TIMING_OPTIONS[timingKey] ? timingKey : 'month',
    advice: ADVICE_THEMES[adviceKey] ? adviceKey : 'act',
    upper,
    lower,
    element,
    pick: choice?.pick || '',
    optionProbabilities: choice?.optionProbabilities || [],
    latencyMs: 0,
    inputTokens: 0,
    rawAnswers: null
  };
}

export function normalizeModelDecision(data, local, pickMap = {}) {
  const answers = data?.answers || {};
  const answerList = Object.values(answers);
  const confidences = answerList.map((a) => a?.confidence).filter((x) => typeof x === 'number' && x >= 0 && x <= 1);
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.74;
  const outcomeP = typeof answers.outcome?.noul === 'number' ? answers.outcome.noul : local.outcomeP;
  const fortuneScore = typeof answers.fortune?.score === 'number' ? answers.fortune.score : null;
  const fortune = fortuneScore === null ? local.fortune : clamp(Math.round((fortuneScore / 6) * 100), 3, 99);

  const timing = answers.timing?.choice && TIMING_OPTIONS[answers.timing.choice] ? answers.timing.choice : local.timing;
  const advice = answers.advice?.choice && ADVICE_THEMES[answers.advice.choice] ? answers.advice.choice : local.advice;
  const upper = answers.upper?.choice && TRIGRAMS[answers.upper.choice] ? answers.upper.choice : local.upper;
  const lower = answers.lower?.choice && TRIGRAMS[answers.lower.choice] ? answers.lower.choice : local.lower;
  const element = answers.element?.choice && ELEMENTS[answers.element.choice] ? answers.element.choice : local.element;

  const pickKey = answers.pick?.choice;
  const pick = pickKey && pickMap[pickKey] ? pickMap[pickKey] : local.pick;
  let optionProbabilities = local.optionProbabilities;
  if (answers.pick?.probabilities && Object.keys(pickMap).length) {
    optionProbabilities = Object.entries(answers.pick.probabilities).map(([key, probability]) => ({
      label: pickMap[key] || key,
      probability: Number(probability) || 0
    }));
  }

  return {
    ...local,
    source: 'model',
    model: data.model || 'decision-model-preview',
    outcomeP,
    fortune,
    confidence: Math.round(avgConfidence * 100),
    timing,
    advice,
    upper,
    lower,
    element,
    pick,
    optionProbabilities,
    latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : null,
    inputTokens: data.usage?.input_tokens || 0,
    rawAnswers: answers
  };
}

/* ------------------------------------------------------------------ */
/* 判词组装                                                           */
/* ------------------------------------------------------------------ */

function fortuneLabel(score) {
  return tierForScore(score);
}

function luckyFromElement(element, rng) {
  const el = ELEMENTS[element] || ELEMENTS.earth;
  return {
    element: el.label,
    color: el.color,
    number: 1 + Math.floor(rng() * 9),
    direction: el.direction,
    time: pick(rng, LUCKY_TIMES)
  };
}

export function composeReading(input, profile, decision) {
  const analysis = analyzeQuestion(input.question, input.options, { domain: input.contextDomain });
  const domain = DOMAINS[analysis.domain] || DOMAINS.decision;
  const isChoice = analysis.kind === 'choice' && analysis.choices.length >= 2 && input.mode === 'choice';
  const isScore = input.mode === 'score';
  const p = clamp(Number(decision.outcomeP) || 0.5, 0, 1);
  const favorable = p >= 0.5;

  const tier = fortuneLabel(decision.fortune);
  let timingKey = decision.timing;
  let adviceKey = decision.advice;
  if (timingKey === 'wait' && p >= 0.5 && ['act', 'invest', 'move'].includes(adviceKey)) {
    timingKey = 'week';
  }
  if (timingKey === 'wait' && p < 0.5) {
    adviceKey = 'wait';
  }
  const timing = TIMING_OPTIONS[timingKey] || TIMING_OPTIONS.month;
  const advice = ADVICE_THEMES[adviceKey] || ADVICE_THEMES.act;
  const upper = TRIGRAMS[decision.upper] || TRIGRAMS.qian;
  const lower = TRIGRAMS[decision.lower] || TRIGRAMS.kun;
  const hex = HEXAGRAM_BY_PAIR[`${upper.key}-${lower.key}`] || HEXAGRAM_BY_PAIR['qian-kun'];
  const element = ELEMENTS[decision.element] ? decision.element : (profile?.favorableElement || 'earth');
  const rng = rngFrom('compose-v1', input.question, profile?.signature || '', decision.upper, decision.lower, decision.advice, decision.pick || '', decision.timing, Math.round(p * 100), hex.number);

  const reason = favorable ? pick(rng, domain.reasonsYes) : pick(rng, domain.reasonsNo);
  const actionsPool = favorable ? domain.actionsYes : domain.actionsNo;
  const actions = sampleUnique(rng, [...actionsPool, advice.detail], 3);
  const avoid = sampleUnique(rng, [...domain.avoid, domain.caution], 2);

  let verdict;
  let probability;
  if (isChoice) {
    verdict = decision.pick || analysis.choices[0];
    const found = (decision.optionProbabilities || []).find((x) => x.label === verdict);
    probability = found ? Math.round(found.probability * 100) : Math.round((1 / analysis.choices.length) * 100);
  } else if (isScore) {
    verdict = fortuneLabel(decision.fortune).label;
    probability = Math.round(decision.fortune);
  } else if (analysis.kind === 'when') {
    verdict = timing.label;
    probability = Math.round(Math.max(p, 1 - p) * 100);
  } else if (analysis.kind === 'why') {
    verdict = favorable ? '事出有因' : '另有隐情';
    probability = Math.round(Math.max(p, 1 - p) * 100);
  } else if (analysis.kind === 'how') {
    verdict = favorable ? '有解' : '先守';
    probability = Math.round(Math.max(p, 1 - p) * 100);
  } else {
    verdict = favorable ? analysis.proposition.yes : analysis.proposition.no;
    probability = Math.round(Math.max(p, 1 - p) * 100);
  }

  const fillTemplate = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');
  const outcome = OUTCOME_LINES[analysis.domain] || {};
  const outcomeLine = favorable
    ? (pick(rng, outcome.yes) || domain.yesLine)
    : (pick(rng, outcome.no) || domain.noLine);

  let headline;
  if (isChoice) {
    const other = analysis.choices.filter((x) => x !== verdict);
    headline = pick(rng, [
      `就选「${verdict}」。别再用「再想想」给犹豫续费。`,
      `判官落笔：${verdict}。${other.length ? `「${other[0]}」不是错，只是不是你的。` : '这次别再回头比较。'}`,
      `选「${verdict}」。你不是缺信息，你是缺一个拍板的瞬间。`,
      `「${verdict}」。再比较下去，两个选项都会过期。`,
      `判官替你拍板：「${verdict}」。${other.length ? `把「${other[0]}」从清单上划掉。` : '选定了就别再回头看。'}`
    ]);
  } else if (isScore) {
    headline = tier.line;
  } else if (analysis.kind === 'when') {
    headline = fillTemplate(pick(rng, WHEN_LINES), { timing: timing.label, note: timing.note });
  } else if (analysis.kind === 'why') {
    headline = fillTemplate(pick(rng, WHY_LINES), { reason });
  } else if (analysis.kind === 'how') {
    headline = fillTemplate(pick(rng, HOW_LINES), { action: actions[0] || advice.detail });
  } else {
    const isShould = /(该不该|要不要|是否应该|应不应该|适不适合|值不值得)/.test(input.question);
    const domainLine = isShould ? (favorable ? domain.yesLine : domain.noLine) : outcomeLine;
    headline = pick(rng, [
      `${verdict}。${domainLine}`,
      `判官直断：${verdict}。${domainLine}`,
      `${verdict}，这是今天的答案。${domainLine}`,
      `判官落笔：${verdict}。${domainLine}`,
      `${verdict}。别再把这个问题翻来覆去——${domainLine}`
    ]);
  }
  const poemObj = POEMS[(hex.number + Math.floor(rng() * POEMS.length)) % POEMS.length];
  const closer = pick(rng, CLOSERS);
  const yi = sampleUnique(rng, YI_ACTIVITIES, 3);
  const ji = sampleUnique(rng, JI_ACTIVITIES, 2);
  const lucky = luckyFromElement(element, rng);
  const confidence = isChoice || isScore
    ? Math.round(Number(decision.confidence) || 0)
    : probability;
  const probabilityText = isChoice
    ? `模型给「${verdict}」的概率是 ${probability}%`
    : isScore
      ? `气运指数 ${probability}`
      : `判官对这一判的把握是 ${probability}%`;

  const cleanTail = (value) => String(value || '').replace(/[。！？；，、\s]+$/g, '');
  const detail = [
    `${domain.label}局。${cleanTail(reason)}。这不是「可能」，是判官看到的趋势。`,
    `应期落在${timing.label}（${timing.short}）。${timing.note} 最该做的是：${advice.detail}`,
    `卦象${hex.name}：${hex.judgment} ${hex.reading}`,
    decision.source === 'model'
      ? `这一判由决策模型落笔，${probabilityText}，不是随机抽签。`
      : `这一判由本地玄机引擎落笔，${probabilityText}。模型暂时离线，答案依旧算数。`
  ];

  const chatName = profile?.name || input.name || '';
  const templated = ['when', 'why', 'how'].includes(analysis.kind) && !isChoice && !isScore;
  const openerPool = chatName ? CHAT_OPENERS : CHAT_OPENERS.filter((o) => !o.includes('{name}'));
  const opener = templated ? '' : pick(rng, openerPool).replace('{name}', chatName);
  const ack = analysis.followUp ? pick(rng, FOLLOWUP_ACK) : '';
  let chatBody;
  if (isChoice) {
    chatBody = `选「${verdict}」。${cleanTail(advice.short)}。${cleanTail(actions[0])}。`;
  } else if (isScore) {
    chatBody = `${tier.line} ${cleanTail(advice.short)}。${cleanTail(actions[0])}。`;
  } else if (analysis.kind === 'when') {
    chatBody = `${fillTemplate(pick(rng, WHEN_LINES), { timing: timing.label, note: timing.note })} ${cleanTail(advice.short)}。`;
  } else if (analysis.kind === 'why') {
    chatBody = `${fillTemplate(pick(rng, WHY_LINES), { reason })} ${cleanTail(actions[0])}。`;
  } else if (analysis.kind === 'how') {
    chatBody = `${fillTemplate(pick(rng, HOW_LINES), { action: actions[0] || advice.detail })} ${cleanTail(advice.short)}。`;
  } else {
    chatBody = `${verdict}。${outcomeLine} ${cleanTail(actions[0])}。`;
  }
  const chatReply = `${ack}${opener}${chatBody}`;

  const signature = signatureFor(input.question, verdict, hex.name, todayKey()).slice(0, 6);

  return {
    id: `read_${hashString(`${input.question}|${Date.now()}`)}`,
    createdAt: new Date().toISOString(),
    mode: isChoice ? 'choice' : isScore ? 'score' : 'verdict',
    question: input.question,
    name: profile?.name || input.name || '',
    answer: {
      verdict,
      kind: analysis.kind,
      followUp: analysis.followUp,
      proposition: analysis.proposition.text,
      probability,
      confidence,
      fortune: decision.fortune,
      tier,
      domain: analysis.domain,
      domainLabel: domain.label,
      timing: { key: timingKey, ...timing },
      advice: { key: adviceKey, ...advice },
      element,
      hexagram: hex,
      upper,
      lower,
      pick: isChoice ? verdict : '',
      options: isChoice ? analysis.choices : [],
      optionProbabilities: isChoice ? decision.optionProbabilities : []
    },
    headline,
    detail,
    poem: poemObj.lines,
    actions,
    avoid,
    yi,
    ji,
    lucky,
    closer,
    chatReply,
    signature,
    meta: {
      source: decision.source,
      model: decision.model,
      latencyMs: decision.latencyMs,
      inputTokens: decision.inputTokens,
      confidence,
      generatedAt: new Date().toISOString()
    }
  };
}

/* ------------------------------------------------------------------ */
/* 决策模型请求构造                                                   */
/* ------------------------------------------------------------------ */

function profileState(profile) {
  if (!profile?.valid) {
    return {
      name: profile?.name || '',
      birth: profile?.birth || '',
      note: '未提供完整生辰，按问事时辰与问题语义判断'
    };
  }
  return {
    name: profile.name,
    gender: profile.gender || '',
    birth: profile.birth,
    time: profile.timeKnown ? profile.time : '未知',
    zodiac: profile.zodiac,
    dayMaster: profile.dayMaster?.label,
    elementScores: profile.elementScores,
    strongest: ELEMENTS[profile.strongest]?.label,
    weakest: ELEMENTS[profile.weakest]?.label,
    favorable: ELEMENTS[profile.favorableElement]?.label,
    archetype: profile.archetype?.title
  };
}

export function buildDecisionRequest(input, profile) {
  const analysis = analyzeQuestion(input.question, input.options, { domain: input.contextDomain });
  const local = buildLocalDecision(input, profile, analysis);
  const options = analysis.choices;
  const pickMap = {};
  const pickCriteria = {};
  options.forEach((label, i) => {
    pickMap[`opt${i}`] = label;
    pickCriteria[`opt${i}`] = `选项 ${String.fromCharCode(65 + i)}：${label}`;
  });

  const questions = {
    outcome: {
      type: 'noul',
      instructions: `在娱乐命理语境下，判断这个命题是否成立：${analysis.proposition.text}。请给出明确倾向，不要因为问题模糊而回避。`,
      criteria: { true: '成立/有利', false: '不成立/不利' }
    },
    fortune: {
      type: 'score',
      instructions: '这件事的整体气运与顺利程度如何？请按七级量表判断。',
      criteria: FORTUNE_SCALE
    },
    timing: {
      type: 'choice',
      instructions: '这件事最关键的应期或最佳行动窗口是什么？',
      criteria: TIMING_CRITERIA
    },
    advice: {
      type: 'choice',
      instructions: '判官最应该给问卜者的一条行动建议是什么？',
      criteria: ADVICE_CRITERIA
    },
    upper: {
      type: 'choice',
      instructions: '用易经上卦表示这件事的外在形势与天时，选一个最贴切的卦象。',
      criteria: TRIGRAM_CRITERIA
    },
    lower: {
      type: 'choice',
      instructions: '用易经下卦表示问卜者的内在根基与处境，选一个最贴切的卦象。',
      criteria: TRIGRAM_CRITERIA
    },
    element: {
      type: 'choice',
      instructions: '哪一种五行最能帮助问卜者破局或助运？',
      criteria: ELEMENT_CRITERIA
    }
  };

  if (options.length >= 2) {
    questions.pick = {
      type: 'choice',
      instructions: '在给定选项中，哪一个最值得选？必须选一个，不要弃权。',
      criteria: pickCriteria
    };
  }

  const chatContext = Array.isArray(input.chatContext)
    ? input.chatContext.slice(-6).map((m) => `${m.role === 'user' ? '问卜者' : '判官'}：${String(m.content || '').slice(0, 180)}`).join('\n')
    : '';

  const payload = {
    model: 'decision-model-preview',
    state: {
      scene: '「天机判官」是一个娱乐性 AI 命理互动网站。以下内容均为虚构命理情境，不构成医疗、法律、投资、心理等专业建议。',
      task: '请根据问题、命盘摘要、关键词信号和对话上下文，做出一致的结构化判断。判词要确定、直接、有画面感，不要模棱两可，不要输出解释性长文。',
      date: todayKey(),
      user: profileState(profile),
      question: String(input.question || '').slice(0, 300),
      questionKind: analysis.kind,
      followUp: analysis.followUp || undefined,
      positiveProposition: analysis.proposition.text,
      detectedDomain: analysis.domainLabel,
      options: options.length ? options : undefined,
      chatContext: chatContext || undefined,
      guidance: '这是娱乐互动。涉及健康、法律、投资时，请在建议方向中体现谨慎与求助于专业人士。'
    },
    questions
  };

  return { payload, local, analysis, pickMap };
}

/* ------------------------------------------------------------------ */
/* 姻缘合盘                                                           */
/* ------------------------------------------------------------------ */

const MATCH_DYNAMIC = {
  complement: { label: '互补', line: '你们像两块缺口刚好对上的拼图，差异会互相补位。' },
  similar: { label: '同频', line: '你们太像了，默契是真的，盲区也是真的。' },
  pushpull: { label: '拉扯', line: '你们之间吸引力很强，但相处像拔河，需要有一个人先松手。' },
  onesided: { label: '单方付出', line: '这段关系里，投入长期不对等，先看清再谈未来。' },
  family: { label: '家人般', line: '你们之间有很深的熟悉感，但激情需要重新点火。' },
  passing: { label: '过客', line: '你们在彼此生命里出现，是为了完成一段功课，不一定是为了留下。' }
};

const MATCH_ADVICE = {
  talk: { label: '把话说透', line: '你们缺的不是爱，是一次不带防御的沟通。' },
  boundary: { label: '立好边界', line: '先谈规则，再谈感情，反而更长久。' },
  slow: { label: '慢一点', line: '别急着定义关系，先看三个月的日常相处。' },
  letgo: { label: '学会放手', line: '有些关系最好的结局，是彼此祝福后各走各路。' },
  commit: { label: '认真承诺', line: '如果你们都想稳定，就把关系往前推一步。' },
  space: { label: '留出空间', line: '靠得太紧会窒息，给彼此一点呼吸的距离。' }
};

function relationBetween(a, b) {
  const ea = a?.dayMaster?.element || 'earth';
  const eb = b?.dayMaster?.element || 'earth';
  const generates = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
  const controls = { wood: 'earth', earth: 'water', water: 'fire', fire: 'metal', metal: 'wood' };
  if (ea === eb) return { type: '同', score: 3, line: '同气相求，容易理解彼此，也容易一起钻牛角尖。' };
  if (generates[ea] === eb) return { type: '生', score: 8, line: `${ELEMENTS[ea].label}生${ELEMENTS[eb].label}，你愿意托举对方，对方也接得住。` };
  if (generates[eb] === ea) return { type: '生', score: 8, line: `${ELEMENTS[eb].label}生${ELEMENTS[ea].label}，对方能给你补给，你也要记得回流。` };
  if (controls[ea] === eb) return { type: '克', score: -6, line: `${ELEMENTS[ea].label}克${ELEMENTS[eb].label}，你容易主导，对方容易憋着。` };
  if (controls[eb] === ea) return { type: '克', score: -6, line: `${ELEMENTS[eb].label}克${ELEMENTS[ea].label}，对方容易压住你，边界要说清。` };
  return { type: '平', score: 0, line: '五行关系平稳，没有天生的大起大落，全靠后天经营。' };
}

export function buildLocalMatch(a, b) {
  const rng = rngFrom('match-v1', a?.signature || '', b?.signature || '', todayKey());
  const relation = relationBetween(a, b);
  const base = clamp(Math.round(42 + rng() * 48 + relation.score), 18, 98);
  const spark = clamp(Math.round(base + (rng() - 0.5) * 16), 10, 99);
  const bondP = clamp(0.25 + base / 130 + (rng() - 0.5) * 0.12, 0.05, 0.95);
  const dynamicKeys = Object.keys(MATCH_DYNAMIC);
  const adviceKeys = Object.keys(MATCH_ADVICE);
  const dynamic = base > 72 ? pick(rng, ['complement', 'similar', 'family']) : base < 45 ? pick(rng, ['onesided', 'passing', 'pushpull']) : pick(rng, dynamicKeys);
  const advice = base > 75 ? pick(rng, ['commit', 'talk', 'slow']) : base < 45 ? pick(rng, ['letgo', 'boundary', 'space']) : pick(rng, adviceKeys);
  const upper = pick(rng, TRIGRAM_ORDER);
  const lower = pick(rng, TRIGRAM_ORDER);
  return {
    source: 'local',
    model: 'local-oracle-v1',
    score: base,
    spark,
    bondP,
    dynamic,
    advice,
    upper,
    lower,
    confidence: Math.round(58 + rng() * 34),
    relation,
    latencyMs: 0,
    inputTokens: 0
  };
}

export function buildMatchRequest(a, b) {
  const local = buildLocalMatch(a, b);
  const questions = {
    bond: {
      type: 'noul',
      instructions: '这两个人之间是否有长期稳定相处的缘分？请给出明确倾向。',
      criteria: { true: '有长期缘分', false: '缘分较浅或难以长期' }
    },
    spark: {
      type: 'score',
      instructions: '两人的吸引、默契与相处顺畅度综合如何？',
      criteria: FORTUNE_SCALE
    },
    dynamic: {
      type: 'choice',
      instructions: '两人最核心的相处模式是什么？',
      criteria: {
        complement: '互补：差异能互相补位',
        similar: '同频：高度相似，默契强',
        pushpull: '拉扯：吸引力强但容易互相消耗',
        onesided: '单方付出：投入长期不对等',
        family: '家人般：熟悉稳定但缺少激情',
        passing: '过客：短暂相遇，完成一段功课'
      }
    },
    advice: {
      type: 'choice',
      instructions: '这段关系最需要的一条建议是什么？',
      criteria: {
        talk: '把话说透：进行一次不带防御的沟通',
        boundary: '立好边界：先谈规则再谈感情',
        slow: '慢一点：用三个月观察日常相处',
        letgo: '学会放手：彼此祝福后各走各路',
        commit: '认真承诺：把关系往前推一步',
        space: '留出空间：给彼此呼吸的距离'
      }
    },
    upper: {
      type: 'choice',
      instructions: '用易经上卦表示这段关系的外在形势。',
      criteria: TRIGRAM_CRITERIA
    },
    lower: {
      type: 'choice',
      instructions: '用易经下卦表示这段关系的内在根基。',
      criteria: TRIGRAM_CRITERIA
    }
  };

  return {
    local,
    payload: {
      model: 'decision-model-preview',
      state: {
        scene: '娱乐性姻缘合盘。请把以下内容视为虚构命理情境，不构成任何专业建议。',
        task: '根据两人的命盘摘要与关键词，判断关系契合度与相处模式。要直接、明确，不要模棱两可。',
        date: todayKey(),
        personA: profileState(a),
        personB: profileState(b),
        elementRelation: local.relation,
        guidance: '关系建议要尊重双方边界，不鼓励操控、纠缠或忽视安全。'
      },
      questions
    }
  };
}

export function normalizeMatchDecision(data, local) {
  const answers = data?.answers || {};
  const confidences = Object.values(answers).map((a) => a?.confidence).filter((x) => typeof x === 'number');
  const avg = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.72;
  const sparkScore = typeof answers.spark?.score === 'number' ? clamp(Math.round((answers.spark.score / 6) * 100), 5, 99) : local.spark;
  const bondP = typeof answers.bond?.noul === 'number' ? answers.bond.noul : local.bondP;
  const score = Math.round(sparkScore * 0.62 + bondP * 100 * 0.38);
  return {
    ...local,
    source: 'model',
    model: data.model || 'decision-model-preview',
    spark: sparkScore,
    bondP,
    score: clamp(score, 8, 99),
    dynamic: answers.dynamic?.choice && MATCH_DYNAMIC[answers.dynamic.choice] ? answers.dynamic.choice : local.dynamic,
    advice: answers.advice?.choice && MATCH_ADVICE[answers.advice.choice] ? answers.advice.choice : local.advice,
    upper: answers.upper?.choice && TRIGRAMS[answers.upper.choice] ? answers.upper.choice : local.upper,
    lower: answers.lower?.choice && TRIGRAMS[answers.lower.choice] ? answers.lower.choice : local.lower,
    confidence: Math.round(avg * 100),
    latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : null,
    inputTokens: data.usage?.input_tokens || 0,
    rawAnswers: answers
  };
}

export function composeMatch(a, b, decision) {
  const score = clamp(decision.score, 0, 100);
  const relation = decision.relation || relationBetween(a, b);
  const dynamic = MATCH_DYNAMIC[decision.dynamic] || MATCH_DYNAMIC.similar;
  const advice = MATCH_ADVICE[decision.advice] || MATCH_ADVICE.talk;
  const upper = TRIGRAMS[decision.upper] || TRIGRAMS.qian;
  const lower = TRIGRAMS[decision.lower] || TRIGRAMS.kun;
  const hex = HEXAGRAM_BY_PAIR[`${upper.key}-${lower.key}`] || HEXAGRAM_BY_PAIR['qian-kun'];
  const rng = rngFrom('match-compose', a?.signature || '', b?.signature || '', score, dynamic.label, hex.number);
  const label = score >= 85 ? '天作之合' : score >= 72 ? '强契合' : score >= 60 ? '可发展' : score >= 48 ? '需磨合' : score >= 35 ? '缘浅' : '建议放手';
  const headline = pick(rng, [
    `${label}。${dynamic.line}`,
    `判官落笔：${label}。${advice.line}`,
    `${score} 分。${label}，但关系从来不是分数决定的。`
  ]);
  const names = `${a?.name || '你'} × ${b?.name || '对方'}`;
  const detail = [
    `${names}。${relation.line}`,
    `你们的相处模式是「${dynamic.label}」：${dynamic.line}`,
    `卦象${hex.name}：${hex.judgment} ${hex.reading}`,
    `判官建议：${advice.line}`
  ];
  const signature = signatureFor('match', names, score, hex.name).slice(0, 6);
  return {
    id: `match_${hashString(`${names}|${Date.now()}`)}`,
    createdAt: new Date().toISOString(),
    names,
    score,
    label,
    headline,
    detail,
    dynamic: dynamic.label,
    advice: advice.line,
    hexagram: hex,
    relation: relation.line,
    signature,
    meta: {
      source: decision.source,
      model: decision.model,
      confidence: decision.confidence,
      latencyMs: decision.latencyMs,
      inputTokens: decision.inputTokens
    }
  };
}

/* ------------------------------------------------------------------ */
/* 二十四节气灵签                                                     */
/* ------------------------------------------------------------------ */

const LOT_LEVEL_SCORE = { '上上': 96, '上吉': 86, '中吉': 72, '中平': 55, '下下': 32 };

const DRAW_TURNS = {
  rise: { label: '转机上升', line: '局面在往上走，抓住接下来两周的窗口。' },
  hold: { label: '守成为上', line: '先不扩张，把已有的东西守住。' },
  cut: { label: '断舍离', line: '该结束的结束，腾出位置给新的东西。' },
  act: { label: '主动出击', line: '别再等信号，先做第一步。' },
  wait: { label: '静候时机', line: '现在不动，就是最好的动作。' },
  move: { label: '换场破局', line: '换环境、换圈子、换节奏，比硬扛有效。' }
};

const DRAW_ADVICE = {
  act: '48 小时内做一个最小动作',
  wait: '把决定压到下一个节气',
  talk: '把没说出口的话说完',
  cut: '结束一个持续消耗你的东西',
  guard: '守住现金、健康和核心关系',
  learn: '先补上最关键的信息差',
  move: '换一个环境重新开始'
};

export function buildLocalLotDecision(input) {
  const rng = rngFrom('lot-v1', input.question || '', input.name || '', todayKey(), input.nonce || '');
  const index = Math.floor(rng() * LOTS.length);
  const lot = LOTS[index];
  const fitP = clamp(0.58 + rng() * 0.34, 0.3, 0.94);
  const turnKeys = Object.keys(DRAW_TURNS);
  const adviceKeys = Object.keys(DRAW_ADVICE);
  return {
    source: 'local',
    model: 'local-oracle-v1',
    lotId: lot.id,
    fitP,
    turn: pick(rng, turnKeys),
    advice: pick(rng, adviceKeys),
    fortune: clamp((LOT_LEVEL_SCORE[lot.level] || 60) + Math.round((rng() - 0.5) * 10), 10, 99),
    confidence: Math.round(60 + rng() * 32),
    latencyMs: 0,
    inputTokens: 0
  };
}

export function buildDrawRequest(input, profile) {
  const analysis = analyzeQuestion(input.question, []);
  const local = buildLocalLotDecision(input);
  const criteria = {};
  for (const lot of LOTS) {
    criteria[`lot-${lot.id}`] = `${lot.name}（${lot.level}）：${lot.keywords.join('、')}。${lot.oracle}`;
  }
  const questions = {
    lot: {
      type: 'choice',
      instructions: '请从二十四节气灵签中为问卜者抽一支最相应之签。必须选一支。',
      criteria
    },
    fit: {
      type: 'noul',
      instructions: '这支签与问卜者所问之事是否相应？',
      criteria: { true: '相应，可以据此参考', false: '不太相应，提醒先缓' }
    },
    turn: {
      type: 'choice',
      instructions: '此签指向的主要转机类型是什么？',
      criteria: Object.fromEntries(Object.entries(DRAW_TURNS).map(([k, v]) => [k, `${v.label}：${v.line}`]))
    },
    advice: {
      type: 'choice',
      instructions: '此签最核心的行动建议是什么？',
      criteria: Object.fromEntries(Object.entries(DRAW_ADVICE).map(([k, v]) => [k, v]))
    },
    fortune: {
      type: 'score',
      instructions: '此签对应的整体气运如何？',
      criteria: FORTUNE_SCALE
    }
  };
  return {
    local,
    analysis,
    payload: {
      model: 'decision-model-preview',
      state: {
        scene: '娱乐性灵签抽取。二十四节气签为原创娱乐文案，不构成任何专业建议。',
        task: '根据问题、命盘摘要和关键词，从二十四支签中选一支最相应的，并判断应期与建议。',
        date: todayKey(),
        user: profileState(profile),
        question: String(input.question || '').slice(0, 300),
        detectedDomain: analysis.domainLabel
      },
      questions
    }
  };
}

export function normalizeDrawDecision(data, local) {
  const answers = data?.answers || {};
  const confidences = Object.values(answers).map((a) => a?.confidence).filter((x) => typeof x === 'number');
  const avg = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.72;
  const lotKey = answers.lot?.choice || '';
  const lotId = Number(String(lotKey).replace('lot-', '')) || local.lotId;
  const fortuneScore = typeof answers.fortune?.score === 'number' ? clamp(Math.round((answers.fortune.score / 6) * 100), 5, 99) : local.fortune;
  return {
    ...local,
    source: 'model',
    model: data.model || 'decision-model-preview',
    lotId,
    fitP: typeof answers.fit?.noul === 'number' ? answers.fit.noul : local.fitP,
    turn: answers.turn?.choice && DRAW_TURNS[answers.turn.choice] ? answers.turn.choice : local.turn,
    advice: answers.advice?.choice && DRAW_ADVICE[answers.advice.choice] ? answers.advice.choice : local.advice,
    fortune: fortuneScore,
    confidence: Math.round(avg * 100),
    latencyMs: typeof data.latency_ms === 'number' ? data.latency_ms : null,
    inputTokens: data.usage?.input_tokens || 0,
    rawAnswers: answers
  };
}

export function composeLot(lot, input, profile, decision) {
  const analysis = analyzeQuestion(input.question, []);
  const domain = DOMAINS[analysis.domain] || DOMAINS.decision;
  const turn = DRAW_TURNS[decision.turn] || DRAW_TURNS.hold;
  const fit = (decision.fitP || 0) >= 0.5;
  const rng = rngFrom('lot-compose', lot.id, input.question || '', decision.turn, decision.advice);
  const score = clamp(decision.fortune, 0, 100);
  const label = lot.level;
  const headline = fit ? `${label} · ${lot.oracle}` : `${label} · 此签提醒你先缓，不要逆势硬推。`;
  const detail = [
    `签文：${lot.poem.join('，')}。`,
    `解签：${lot.oracle} ${lot.advice}`,
    `落到你的问题上：${domain.label}局，${fit ? '此签相应，可以据此行动' : '此签不完全相应，先把自己按住'}。${turn.line}`,
    `行动建议：${DRAW_ADVICE[decision.advice] || '先做一件小事，让局面动起来'}。别把抽签当成拖延的借口。`
  ];
  const actions = sampleUnique(rng, [DRAW_ADVICE[decision.advice], lot.advice, ...(fit ? domain.actionsYes : domain.actionsNo)], 3);
  const yi = sampleUnique(rng, YI_ACTIVITIES, 3);
  const ji = sampleUnique(rng, JI_ACTIVITIES, 2);
  const lucky = luckyFromElement(profile?.favorableElement || 'earth', rng);
  return {
    id: `lot_${lot.id}_${hashString(`${input.question}|${Date.now()}`)}`,
    createdAt: new Date().toISOString(),
    question: input.question,
    lot,
    score,
    fit,
    headline,
    detail,
    turn: turn.label,
    advice: DRAW_ADVICE[decision.advice],
    actions,
    yi,
    ji,
    lucky,
    signature: signatureFor('lot', lot.id, input.question || '', score).slice(0, 6),
    meta: {
      source: decision.source,
      model: decision.model,
      confidence: decision.confidence,
      latencyMs: decision.latencyMs,
      inputTokens: decision.inputTokens
    }
  };
}
