import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = new URL('../.env', import.meta.url);
const vaultPath = new URL('../vault.json', import.meta.url);

function loadEnv() {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function upsertEnv(key, value) {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text = `${text.replace(/\s*$/, '')}\n${key}=${value}\n`;
  writeFileSync(envPath, text, 'utf8');
}

async function readHidden(prompt) {
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  return answer.trim();
}

let env = loadEnv();
let masterHex = env.ORACLE_MASTER_KEY;
if (!masterHex) {
  masterHex = randomBytes(32).toString('hex');
  upsertEnv('ORACLE_MASTER_KEY', masterHex);
  console.log('已生成 ORACLE_MASTER_KEY 并写入 .env');
}

const master = Buffer.from(masterHex, 'hex');
if (master.length !== 32) {
  console.error('ORACLE_MASTER_KEY 必须是 64 位十六进制字符串（32 字节）。');
  process.exit(1);
}

let apiKey = process.env.DASHSCOPE_API_KEY || env.DASHSCOPE_API_KEY || '';
if (!apiKey) apiKey = await readHidden('请粘贴决策模型 API Key：');
if (!apiKey) {
  console.error('没有拿到 API Key。');
  process.exit(1);
}

const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', master, iv);
const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

const vault = {
  v: 1,
  alg: 'aes-256-gcm',
  createdAt: new Date().toISOString(),
  iv: iv.toString('base64'),
  tag: tag.toString('base64'),
  data: encrypted.toString('base64')
};

writeFileSync(vaultPath, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600 });
console.log(`密钥已加密写入 vault.json（${root}）。主密码只在 .env 中，浏览器永远拿不到。`);
