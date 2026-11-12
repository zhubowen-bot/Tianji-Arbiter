# 天机判官 · GUNCAT ORACLE

一个由decision model（决策判断模型）驱动的，只给确定答案的娱乐性 AI 命理判官。  
决策模型负责「判」，本地玄机引擎负责把判词说具体，前端负责把它做得像一场可以玩很久的仪式。

> 娱乐性内容，不构成医疗、法律、投资、心理等专业建议。  
> 命理是壳，决定才是核。

---

## 它有什么

- **判是非**：问「该不该 / 会不会 / 能不能 / 值不值得」，给出明确判词，不给「看情况」。
- **二选一**：两个到六个选项，判官直接选一个，并给出概率分布。
- **问吉凶**：七级气运、应期、卦象、五行助运、宜忌和行动清单。
- **每日运势**：按日期与个人签名计算六维运势、今日主题、宜忌、幸运色/方位/数字/时辰。
- **抉择擂台**：单独的选择题面板，结果可展开成完整判词。
- **缘分合盘**：两个人的命盘、五行关系、契合指数、相处模式和关系建议。
- **二十四节气灵签**：24 支原创签文，按问题由决策模型匹配，签文 + 解签 + 行动建议。
- **命格排盘**：简化四柱、五行分布、日主、命格原型、天赋与盲区。
- **判官问答**：任意问题直接问，自动识别是非/选择/何时/为何/怎么办；寒暄闲聊本地应答不耗模型配额，追问自动继承上一轮领域。
- **我的命帖**：生辰立一次全站同步（各殿表单双向绑定），合盘对象单独记忆；命帖页即时预览简盘。
- **多页面结构**：首页总览 + 七座功能殿 + 命帖 + 香火簿，哈希路由一次只显一页，支持深链与浏览器前进/后退。
- **互动层**：香火簿独立页（按类型筛选、单条删除、跨页复现判词）、功德、判官印记、音效、判词朗读、判词分享图、Ctrl/Cmd + Enter 落笔。
- **离线兜底**：模型不可用、超时或限流时，本地玄机引擎照样给出完整判词，不会白屏。
- **确定性**：同一个问题、同一个生日、同一天，判词稳定可复现；模型回答在服务端缓存 24 小时。

---

## 快速启动

要求：Node.js **20.12+**（本项目在 Node 25 上开发）。

```bash
npm start
```

打开 <http://localhost:8787>。

开发时自动重载：

```bash
npm run dev
```

没有第三方依赖，不需要 `npm install`。  
端口在 `.env` 里改 `PORT`。

---

## 密钥是怎么保护的

这是这个项目最重要的部分：

1. **API Key 永远不进浏览器。**
   
   - 前端只拿到一个短期的 HMAC 会话令牌，用来调用本站自己的 `/api/divine`、`/api/match`、`/api/draw`。
   - 真正的 `Authorization: Bearer ...` 只在 `server.js` 里组装。

2. **API Key 在磁盘上加密。**
   
   - `vault.json` 是 AES-256-GCM 密文。
   - 解密主密码放在 `.env` 的 `ORACLE_MASTER_KEY`。
   - `.env` 和 `vault.json` 都已加入 `.gitignore`，不要提交、不要发群、不要放进前端构建产物。

3. **服务端还有这些保护：**
   
   - 短期会话令牌（2 小时，服务重启即失效）
   - 同源检查 / 可选 `ALLOWED_ORIGINS`
   - 每 IP 限流（默认 10 分钟 40 次）
   - 全局模型小时配额（默认 300 次/小时）
   - 请求体大小限制、问题长度限制、选项数量限制
   - CSP、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`
   - 上游错误不把密钥、请求头或完整响应暴露给前端
   - 结果缓存 24 小时，减少重复调用

> `.env` 和 `vault.json` 必须成对保留。只拷 `vault.json` 而没有 `ORACLE_MASTER_KEY`，密钥解不开；只拷 `.env` 而没有 `vault.json`，没有模型密钥。

### 更换 / 重新加密 API Key

```bash
# Windows PowerShell
$env:DASHSCOPE_API_KEY="sk-你的新key"
npm run vault
```

或在 `.env` 里临时写入 `DASHSCOPE_API_KEY=...`，运行 `npm run vault` 后再删掉那行。  
脚本会重新生成 `vault.json`，不会把明文写进任何前端文件。

---

## 环境变量

完整示例见 `.env.example`。

| 变量                            | 说明                                        |
| ----------------------------- | ----------------------------------------- |
| `PORT`                        | 服务端口，默认 `8787`                            |
| `DASHSCOPE_ENDPOINT`          | 决策模型完整端点，默认 trial 域名                      |
| `DASHSCOPE_MODEL`             | 默认 `decision-model-preview`               |
| `ORACLE_MASTER_KEY`           | 64 位十六进制，AES-256-GCM 主密码                  |
| `DASHSCOPE_API_KEY`           | 可选，不加密直接放环境变量时使用（不推荐）                     |
| `RATE_LIMIT_MAX`              | 每 IP 限流次数，默认 40                           |
| `RATE_LIMIT_WINDOW_MS`        | 限流窗口，默认 600000（10 分钟）                     |
| `GLOBAL_MODEL_LIMIT_PER_HOUR` | 全局模型调用小时上限，默认 300                         |
| `TRUST_PROXY`                 | 在 Nginx/Caddy 后面设为 `1`，才能正确取到真实 IP        |
| `ALLOWED_ORIGINS`             | 可选，逗号分隔的允许来源，例如 `https://your-domain.com` |

### 关于 Endpoint

当前 `.env` 使用的是：

```text
https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone
```

trial 域名不需要 WorkspaceId，适合演示和验证，已实测可用。  
正式部署建议换成业务空间专属域名：

```text
https://<你的WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone
```

只需要改 `.env` 的 `DASHSCOPE_ENDPOINT`，然后重启服务。  
决策模型协议是 TypeSafe System One，不是 OpenAI Chat Completions；请求体是 `state` + `questions`，返回值只有结构化判断和概率，不生成文本。

---

## 确定性是怎么实现的

这不是「每次随机抽一句签」：

1. **本地引擎**用问题、姓名、生日、当天日期、模式做种子，使用纯 JS 哈希 + PRNG 选择卦象、签文、判词模板和行动建议。  
   同一组输入、同一天，结果一致。
2. **决策模型**返回 `noul` 概率、`score` 分数、`choice` 选项和置信度。
3. 服务端对「问题 + 命盘摘要 + 问题集」做哈希缓存，**缓存 24 小时**，并持久化到 `data/model-cache.json`（只存哈希和判词结构，不存问题原文）。  
   同一问题当天重复问、甚至服务重启后，都会复用同一次模型判断。
4. 结果卡里会显示 **天机码**，它是问题 + 判词 + 卦象 + 日期的短哈希，方便你核对「是不是同一判」。
5. 模型超时/限流/没网时，自动降级到本地引擎，判词仍然完整，只是来源标记为「本地玄机引擎」。

> 24 小时之后、或者你改了问题/生日，模型可能给出不同概率。这是正常的；判官只保证「今天这次」稳定。

---

## 目录结构

```text
.
├─ server.js                 # Node 原生 HTTP 服务、密钥保险箱、API 代理、限流
├─ vault.json                # AES-256-GCM 加密后的 API Key（不要提交）
├─ .env                      # 主密码与运行配置（不要提交）
├─ scripts/
│  └─ encrypt-key.js         # 生成/更新 vault.json
├─ public/
│  ├─ index.html             # 哈希路由多页面：首页 + 七殿 + 命帖 + 香火簿
│  ├─ favicon.svg
│  ├─ css/style.css          # 墨黑/朱砂/鎏金视觉，无外部依赖
│  └─ js/
│     ├─ data.js             # 10 个领域、64 卦、24 签、闲聊意图与文案库
│     ├─ engine.js           # 排盘、每日、合盘、灵签、判词组装（前后端共用）
│     └─ app.js              # 路由、命帖同步、交互渲染、分享图、香火簿
└─ README.md
```

---

## 部署建议

1. 用 Nginx / Caddy 反代到 `127.0.0.1:8787`，开启 HTTPS。
2. 设置 `TRUST_PROXY=1`，让限流拿到真实 IP。
3. 设置 `ALLOWED_ORIGINS=https://你的域名`。
4. 不要把 `.env`、`vault.json`、项目根目录暴露成静态目录；本项目只服务 `public/`。
5. 如果公开访问量变大，降低 `RATE_LIMIT_MAX` 或加一层 CDN/WAF。
6. 定期检查百炼控制台的模型额度和 API Key 权限，建议给 Key 加 IP 白名单/模型范围限制。

### 常见问题

**`EADDRINUSE`**  
端口被占用。改 `.env` 的 `PORT`，或结束占用 8787 的 Node 进程。

**页面显示「本地玄机在线」，模型不调用**  
`vault.json` 解不开，或 Key 过期/无权限。看服务端日志里的 `[vault]` / `[model]` 提示；重新运行 `npm run vault`。

**模型返回 401 / 403**  
Key 与 Endpoint 地域/套餐不匹配。trial 域名和业务空间域名的 Key 要求不同；确认 `.env` 里的 Endpoint 与 Key 属于同一地域。

**想换模型名**  
改 `DASHSCOPE_MODEL`。当前代码按 `decision-model-preview` 的 System One 协议写；其他模型需要兼容同样的 `state/questions` 协议。

---

## 最后的 disclaimer

这是一个娱乐项目。  
它不预测未来，不替代医疗、法律、投资、心理等专业意见。  
判官只负责把话说死，不负责替你后悔。真正的生活，请交给清醒的你自己。
