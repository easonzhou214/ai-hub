# AI Hub · 供应商额度控制台

统一管理 AI 供应商与额度使用情况的本地看板。视觉参考 Kril 控制台：暖白画布、柔和渐变数据卡、薄荷绿主色与克制的信息密度。

当前版本已接入 **CC Switch**：本地开发服务读取 `~/.cc-switch/cc-switch.db` 中带 Base URL 与 API Key 的 Codex 自定义供应商，并通过供应商自己的 token / 账户接口同步真实额度。对于 Krill Code、Aixor 这类需要网页登录态的账户，提供了本地 Chrome 登录助手。

## 当前能力

- **CC Switch 接入**
  - 首次打开自动导入自定义 Codex 供应商；之后每次刷新会补齐 CC Switch 中新增的供应商
  - 供应商页和账户菜单仍可手动重新导入并更新已有配置
  - 只读取本机数据库，接口仅允许 loopback 访问
- **真实额度同步**
  - 通过本地服务请求供应商的 `/api/usage/token/`、`/api/status`、`/v1/models`
  - 优先使用 token 接口返回的周期额度（如 Packy 的月度额度、剩余额度和重置时间）
  - API Key 被标记为 `unlimited_quota` 时不直接当成账户不限额；如果账户额度没有返回，会标记为「额度待确认」
  - 支持 token 接口在开启「允许查询用户额度」后返回的账户余额
  - 展示模型数量，失败时明确显示「同步失败」，不使用旧的假数据
  - 网络错误 / 超时 / 供应商 5xx 自动重试；Krill 与 Aixor 的 Chrome 读取串行执行，避免争用同一个登录 profile
  - 每次同步结果写入本地 JSONL 日志，头像菜单「同步日志」可直接查看失败原因与耗时
- **Krill / Aixor 网页登录助手**
  - 供应商卡片、供应商列表和编辑面板都提供「登录 Krill / 登录 Aixor」按钮
  - 可见的独立 Chrome 窗口只用于首次登录或会话过期；登录完成后窗口可以关闭
  - 同步时本地服务会自动启动一个**不可见的 headless Chrome**（复用同一登录 profile）读取额度，不需要保持 Chrome 窗口开着
  - 点击登录后打开可见 Chrome；登录后由本地服务在登录页内读取账户接口：
    - Krill：`/api/subscription`
    - Aixor：`/api/user/auth/refresh` 换 access token，再读 `/api/user/self`
  - 登录态过期后按钮重新出现，不需要手动复制 JWT；AI Hub 不保存 Google 密码，也不把 access token / JWT 暴露给前端
  - 登录窗口使用独立的 Chrome 配置目录，和日常 Chrome 会话隔离
- **PixelLab 接入**
  - PixelLab 不在 CC Switch 里：在「添加供应商」里打开「从 PixelLab 接口同步」，填 API Token 即可
  - 保存后立即请求 `https://api.pixellab.ai/v2/balance`（`Authorization: Bearer <token>`），之后跟随自动同步刷新
  - `subscription.generations` 是**本周期剩余次数**、`total` 是周期总量，两者相减得到已用；`credits.usd` 作为钱包余额单独展示
  - 订阅额度按「次」计量，不参与美元汇总：构成图里会注明并按明细单独展示
  - 接口不返回重置日期，列表统一显示「按月重置」
  - 该接口对浏览器开放 CORS，静态部署时也能直接查询；Token 无效会明确提示
- **供应商配置**
  - 编程 / 绘图两类；周期额度、预充值余额两种手动计费方式
  - 新增、编辑、启用 / 停用、删除；Base URL、API Key、标识色、备注
  - 接口同步供应商的额度在编辑面板中只读，避免被手动值覆盖
- **额度总览**
  - 已用累计额度、有限额度剩余、接口同步状态、活跃 / 待关注供应商
  - **额度增量判断「正在消耗」**：每次同步后对比上一次的累计已用与账户余额，谁的额度在减少，就给它的进度条加燃烧动效并标「正在消耗」。这条链路只看服务端同步回来的数据，不读本机 Codex 配置，所以远端部署同样有效
  - 判定口径：只认接口同步的供应商（手动 / 演示数据每轮都会随机涨，不算信号）；最后一次看到增长后保持 15 分钟；两次观测间隔超过 3 小时只更新基线、不追溯点亮
  - 本地开发时如果 `/api/codex/current` 可用，还会按 `~/.codex/config.toml` 额外点亮对应供应商，更即时；远端部署读不到你的本机配置，自动只用上面的增量判断
  - 同一中转站常有多把 Key 共用同一个 Base URL，因此匹配顺序是「API Key（唯一）→ CC Switch 当前账号 → Base URL」，避免用量烧在 A 账号、火焰却挂在 B 账号上
  - 额度卡片按类型分组，组内按风险排序：已过期 → 额度耗尽 → 即将到期 → 额度紧张 → 需要登录 → 同步失败 / 待确认 → 正常
- **使用额度**
  - 按供应商拆分的累计用量构成
  - 周期额度、重置日期、账户余额、累计用量与同步状态明细
- **本地体验**
  - 供应商、额度、账号优先存到本地服务端，`localStorage` 只做缓存；通知中心；响应式布局
  - 导出配置不含 API Key
- **账号与权限**
  - 打开先登录：管理员 `easonzhou`，普通账号由管理员创建
  - 管理员在头像菜单「账号管理」里增删普通账号；管理员账号标记为不可删除
  - 普通账号可正常查看、编辑、同步供应商，但看不到「账号管理」入口
  - 登录态存在 `localStorage`，刷新后保持；「退出登录」清掉会话

## 启动

macOS 和 Windows 都可以直接双击项目根目录的启动脚本：

- macOS：**`start.command`**
- Windows：**`start.bat`**

脚本会：

- 自动查找 Node.js（macOS 优先使用 nvm 中的 Node 22.22.3，同时检查 Homebrew 和常见安装位置；Windows 会检查 PATH 和常见安装位置）
- 启动后自动打开 `http://127.0.0.1:5173`
- 保持窗口开着；关闭窗口或按 `Ctrl+C` 停止
- 如果服务已经在运行，脚本只打开浏览器，不会重复启动

如果 macOS 第一次拦截这个脚本，右键文件选择「打开」即可。Windows 按 `Ctrl+C` 后如果提示 `Terminate batch job (Y/N)?`，输入 `Y`。

也可以在终端手动启动。要求 Node.js **22.13+**（使用了 Node 内置的 `node:sqlite`）。

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

> CC Switch 供应商的额度查询依赖本地 Vite 中间件：它会使用 CC Switch 中的 API Key 请求供应商额度接口，避免部分供应商后台接口没有 CORS 头的问题。把 `dist/` 交给 nginx 之类的纯静态服务器时，`/api/*` 不存在，CC Switch 导入、额度查询和服务端存储都会不可用（PixelLab 是浏览器直连，仍然可用），应用自动退回「仅本机」模式。启动时若读不到 CC Switch 配置，以空列表启动并在通知里说明原因（不会填充任何假数据）。

### 多设备 / 多地址同步

`npm run dev` 和 `npm run preview` 都带一个状态存储接口 `/api/state`，供应商、额度、账号会写进 `.local/hub-state.json`，因此同一个服务下的不同地址（例如 `127.0.0.1` 与服务器 IP）看到的是同一份数据。

- 服务端可用时，数据写入文件，浏览器只保留缓存；不可用时（纯静态部署）自动降级为「仅本机」
- 多端同时修改用 `revision` 做整份文档的乐观锁，写入在同一个临界区里完成「读 → 比对 → 落盘」，冲突时以服务端为准；打开着的页面每 15 秒轮询一次，切换回标签页时也会立即拉取
- 第一次升级到该版本时，如果服务端文件还不存在，浏览器会把已有的 `localStorage` 数据上传作为初始状态；之后所有设备都以服务端为准
- 服务端一旦有数据就以它为准，不再和本地缓存做并集：这样在别的设备上删掉的供应商不会被本机残留「复活」（代价是离线期间的本地新增需要重新添加）
- 存储路径默认是 `./.local/hub-state.json`（已 gitignore），可用环境变量 `AIHUB_STATE_FILE` 指定别的路径

在服务器上跑同一个服务（而不是只丢 `dist/`）：

```bash
npm install
npm run build
npm run serve   # 监听 0.0.0.0:4173，同时提供页面与 /api/*
```

> ⚠️ `/api/state` 没有鉴权，文件里的 API Key 是明文（权限 0600）。公网部署请至少在反向代理层加 Basic Auth / IP 白名单；这仍然是「能打开页面就能看到配置」的模型，不要当成多人隔离方案。
>
> 另外，Krill / Aixor 的登录窗口会开在**运行服务的那台机器**上。如果服务跑在无桌面的服务器，登录按钮点了也看不到窗口；这类场景建议只在一台有桌面的机器上跑服务，其他设备通过隧道 / 反向代理访问同一个地址。

### 本机（服务器）还是客户端

页面自己不知道「我是跑服务的那台机器，还是连过来的另一台设备」——每个请求都是发给服务端进程的，额度也是它在读。`/api/runtime` 会按**连接的来源地址**判断，回环就是 `server`，其他就是 `client`，纯静态部署则没有这个接口。

**同步是任何设备都能做的**：客户端点「同步额度」，请求打到服务端，服务端去读那台机器上的 CC Switch 与登录态，结果写回共享状态，所有设备 15 秒内看到同一份数据。界面上会说清楚「在本机执行」还是「在服务器 `<主机名>` 上执行」。

有两件事只能在服务端那台机器上做，因为要碰本机：

| 动作 | 本机 | 客户端 |
|---|---|---|
| 额度同步 / 手动刷新 | ✅ | ✅（服务端代劳） |
| 新增 / 编辑 / 删除供应商 | ✅ | ✅（写共享状态，其他设备立即看到） |
| 从 CC Switch 导入 | ✅ | ❌ 响应里带 API Key，接口只接受回环请求 |
| 网页登录（Krill / Aixor） | ✅ | ❌ 登录窗口只会弹在服务器上 |

所以 `/api/cc-switch/usage` 对局域网开放（响应里只有额度数字），`/api/cc-switch/providers`、`/api/codex/current`、`/api/cc-switch/login/*`、`/api/cc-switch/logs` 仍然只接受回环请求，客户端会拿到 403 和一句可执行的说明。

### 权限

| 账号 | 能做什么 |
|---|---|
| 管理员 | 全部：增删改供应商、导入 CC Switch、网页登录、管理账号、手动同步 |
| 普通账号 | 查看额度与明细、手动同步；供应商配置只读（新增/编辑/删除/导入/登录入口都不显示） |

> 这是前端门禁，不是真实的服务端鉴权：口令与角色判断都在浏览器里（见「账号与登录」）。要多人隔离，需要把账号体系挪到服务端。

**新增供应商后会自动读一次额度**（PixelLab 浏览器直连，CC Switch 供应商由服务端代劳），读完写回共享状态，不用等别的设备再点一次同步，也不用等 5 分钟的自动同步。

## Krill / Aixor 登录助手

Krill Code 的 relay key（`nb_`）只能调用推理接口；Aixor 的 relay key 上的 `unlimited_quota` 也只代表 Key 本身。两家的账户额度都需要网页登录态。登录助手流程：

1. 在对应供应商卡片上点击「登录 Krill」或「登录 Aixor」。
2. 本地服务启动一个独立的 Chrome 窗口，打开对应登录页。
3. 你完成登录；本地服务通过本机 DevTools 协议在页面里调用账户接口：
   - Krill：`/api/subscription`，展示套餐额度或 `credit_balance_usd`
   - Aixor：先用 `/api/user/auth/refresh` 换 access token，再读 `/api/subscription/self` 的套餐额度和 `/api/user/self` 的钱包余额
4. 读取成功后，卡片自动切换为套餐/余额额度；不会把 JWT / access token 存进 AI Hub 前端。
5. 登录态过期时卡片显示「需要登录」，再点击即可重新打开同一配置目录的窗口。

说明：

- 需要本机安装 Google Chrome，登录窗口和 headless 读取共用 `.local/krill-login-profile`（已 gitignore，Krill 与 Aixor 共用）。
- headless 进程没有窗口，只在同步时启动/复用；它不读取日常 Chrome 的数据。
- 登录窗口与日常 Chrome 分离，不读取日常 Chrome 的 cookie/密码；也不需要把 Google 密码交给 AI Hub。
- 可见 Chrome 关闭后，同步会自动启动 headless Chrome 读取；标签页被关掉会重开，不会因此判定登录失效。
- 只有会话真的过期、headless 接口返回 401 时，才需要点一次登录按钮打开可见窗口重新登录。
- 当前已对 Krill Code 和 Aixor 接入网页登录额度。
- 如果 Google 拒绝自动化浏览器登录，当前没有可用的“无密码全自动续期”方案；可以把控制台额度作为手动额度兜底（下一步支持）。
- 账户余额低于 `$1` 会标记为额度紧张，并产生通知提醒。

## 自动同步的节奏

额度查询是「一轮全量」，触发点只有下面几条：

| 触发 | 节奏 | 说明 |
|---|---|---|
| 启动后首次 | 800ms | 只有数据已过期（超过 5 分钟）才跑 |
| 定时轮询 | 每 5 分钟 | 唯一无条件的自动触发，它就是节奏本身 |
| 切回标签页 | 1.5s | 先过新鲜度闸门 |
| 网络恢复（`online`） | 600ms | 同上；网络抖动时 `online` 会连着来好几下，闸门挡掉重复的全量同步 |
| 新增 / 保存供应商 | 立即 | 只查这一个 |

一轮里的供应商查询是并行发起的。浏览器型（Krill / Aixor）的读取在服务端用一把全局锁串行，
不会同时拉起多个 Chrome；真正会同时打到上游的是 New API 型的那几个账号，
数量多时注意同源限流（429）。

失败不会更新顶栏的「上次同步」，重试另用内存里的「最后一次尝试」+ 60 秒冷却节流。

## 额度口径

- 供应商接口返回的额度单位按 `/api/status` 的 `quota_per_unit` 换算，目前两家都是 `500000` 单位 = 1 美元
- Packy 返回的是**周期额度**：`quota_limit`、`total_available`、`quota_period_start`、`quota_reset_period`
  - 页面用「周期额度 / 本周期已用 / 剩余额度 / 下次重置」展示
  - 与 `total_used`（账户累计用量）分开，不把累计值当作周期额度
- Aixor 的 API Key 本身被标记为不限额，但该标记只代表 Key；登录后读取两类额度：
  - `/api/subscription/self`：活跃订阅的 `amount_total` / `amount_used` / `next_reset_time`，展示为周期额度、剩余额度和重置日期
  - `/api/user/self`：钱包 `quota` / `used_quota`，换算为账户余额
  - 两者同时存在时在卡片/列表/编辑面板中显示两行：**周期额度 + 钱包余额**
- Krill 同时返回订阅额度和 `credit_balance_usd` 时，也按两行展示；周期额度决定主状态，钱包容错单独展示
- 只有周期额度不足/耗尽时才会触发额度紧张；有活跃周期套餐时，钱包余额偏低不会单独把供应商判为异常
- 周期额度剩余为 0 或账户余额为 0 时状态显示「额度耗尽」，已用 80% 及以上但尚未用完显示「额度紧张」
- Krill Code 登录后读取 `/api/subscription` 的订阅/余额字段：`total_limit_usd`、`total_used_usd`、`total_remaining_usd`、`quota.window_reset_at` 与 `credit_balance_usd`
  - 有订阅套餐时展示周期额度，否则展示账户余额
- 网络接口失败保留旧数据；登录态失效时显示「需要登录」而不是伪造余额
- 不把「API Key 不限额」当成「账户不限额」
- 金额支持美元与人民币两种计价（接口返回 `quota_display_type` 时会自动识别）；汇总视图统一折算为美元，汇率按 `$1 = ¥7.2`

## 同步失败与日志

同步失败时不再只有卡片上的一个「同步失败」角标，而是保留可追溯的记录：

- 每次额度同步（成功或失败）写入 `~/.ai-hub/logs/sync-YYYY-MM-DD.jsonl`，保留最近 30 天
- 查看入口：右上角头像 →「同步日志」，可看到时间、供应商、耗时、尝试次数、错误码与完整失败原因
- 日志只写本机；接口仅接受 loopback 请求。写入前会脱敏 `sk-*`、`nb_*`、`Bearer` 与 JWT，不会记录 API Key
- PixelLab 由浏览器直连，失败时会通过 `/api/cc-switch/log` 汇总到同一份日志
- 重试策略：网络错误 / HTTP 408/429/5xx 最多尝试 3 次（超时最多 2 次）；Chrome 登录态读取最多尝试 2 次；401/404 等配置或鉴权错误不重试
- 页面重新可见且上次有失败时，延迟 1.5 秒再同步；系统唤醒或网络恢复（`online`）后会再自动重试，避免唤醒瞬间把全部供应商标记为失败
- 读不到登录助手（Chrome 未启动、标签页仍在加载、CDP 超时）不再判定为登录过期：保留上次快照并标记同步失败，只有供应商接口真正返回 401/403 才显示「需要登录」
- 最近一次成功读取的额度快照写入 `~/.ai-hub/cache/usage-snapshots.json`，同步失败时随错误一起回传，多个浏览器 / 设备因此收敛到同一份数据，不会各自保留旧的登录状态
- 若仍是持续失败，日志中的 `code`（如 `ENOTFOUND`、`ECONNRESET`、`UND_ERR_CONNECT_TIMEOUT`）可直接区分 DNS / 代理 / 超时问题

## 账号与登录

- **管理员**：`easonzhou` / `bob215921`（内置账号，不可删除、不可改名）
  - 这个口令只在**首次运行、本地还没有管理员记录**时用来创建账号；之后以存储里的摘要为准，改过的密码不会被内置口令覆盖
  - 想换引导口令可以在构建前设置 `VITE_ADMIN_BOOTSTRAP_PASSWORD`
- **修改密码**：登录后 → 右上角头像 →「账号管理」→ 底部「修改密码」，填当前密码与新密码（≥ 6 位）→「更新密码」
- **普通账号**：登录后 → 右上角头像 →「账号管理」→ 填用户名 / 显示名称（可选）/ 密码（≥ 6 位）→「添加账号」
- **删除账号**：账号管理列表里点垃圾桶图标，二次确认后删除；管理员行只显示「不可删除」
- **存储**：账号存在 `aihub.accounts.v1`，会话存在 `aihub.session.v2`。服务端可用时，账号列表会随 `/api/state` 同步到 `.local/hub-state.json`，多设备共用一份；会话只留在当前浏览器
- **密码处理**：`src/auth.ts` 里做一次 FNV 加盐摘要后存储，避免明文出现在 DevTools 与 `hub-state.json` 里

> ⚠️ 这是本地单机模式的门禁，不是真实认证：管理员口令随 JS 打包，能打开开发者工具的人都能读到。若要多人共用，需要把账号体系挪到服务端。

## 数据流与安全

1. 浏览器请求同源的 `/api/cc-switch/providers`、`/api/cc-switch/usage`、`/api/codex/current`、`/api/cc-switch/logs` 和 `/api/cc-switch/login/*`。
2. 本地 Vite 中间件以只读方式打开 `~/.cc-switch/cc-switch.db`，使用其中的 API Key 请求 New API 风格额度接口。
3. 对 Krill Code，本地服务启动独立的 Chrome 登录窗口；登录完成后通过 DevTools 协议在 Krill 页面内调用额度接口，JWT 不落 AI Hub 前端。
4. 浏览器不直接请求供应商后台；额度数据由本地服务转发。
5. 供应商配置与导入时得到的 API Key 会写进服务端的 `.local/hub-state.json`，并在浏览器 `localStorage` 留一份缓存；导出的 JSON 会剔除 `apiKey`，只保留 `hasApiKey`。
6. 本地导入、Codex 当前供应商、额度查询、同步日志与登录接口只接受 loopback 请求，并设置 `no-store`。
7. `/api/state` 不做 loopback 限制（否则远端设备无法同步），也不做鉴权；它只应部署在可信网络或反向代理鉴权之后。

注意：

- 这是本地工具，请勿把开发服务暴露到公网。
- API Key 在浏览器本地为明文存储，适合个人机器使用；团队或公网部署应改为服务端加密存储。
- 若供应商更换了 Key 或额度重置，优先使用「从 CC Switch 导入」刷新配置，再同步额度。

## 供应商接口兼容性

- 目前自动匹配的是 CC Switch 中 `app_type = codex` 的自定义供应商，要求提供 Base URL 与 `OPENAI_API_KEY`
- New API 风格的供应商优先读 token 接口；token 接口没有账户额度的，会先显示待确认或引导登录
  - Krill Code 的 relay key 只能调用推理接口，`/api/credits`、`/api/subscription` 需要登录态，通过 Chrome 登录助手读取
  - Aixor 的 `/api/user/self` 需要登录态；助手通过页面里的 refresh cookie 换 token 后读取
- 额度接口返回 404 / 超时 / 非 JSON 时都会保留旧数据并显示失败状态
- CC Switch 新增供应商刷新页面会自动补齐；已有的网页登录态不会自动跨浏览器共享

## 技术结构

- React 19 + TypeScript + Vite
- `vite-plugins/cc-switch.ts`：本地只读 CC Switch 桥接 + 供应商额度查询代理 + 登录 / 日志路由
- `vite-plugins/state-store.ts`：`/api/state` 读写、revision 乐观锁、原子写 `.local/hub-state.json`
- `src/hubState.ts`：服务端优先 + 本地缓存的状态钩子，负责首次迁移、防抖写入与 15 秒轮询
- `src/net.ts`：共享的重试封装（网络可用性判断、退避延迟、按错误类型收窄最大尝试次数）
- `src/providerView.ts`：把供应商派生出的额度 / 余额 / 状态 / 到期 / 登录态收成一份视图对象，卡片、列表与总览共用
- `src/hooks.ts`：`useEscapeKey` / `useInitialFocus` 等浮层交互钩子
- `vite-plugins/sync-log.ts`：同步 JSONL 日志、脱敏、30 天保留与读取接口
- `vite-plugins/krill.ts`：独立 Chrome 登录窗口，Krill `/api/subscription` 与 Aixor `/api/user/auth/refresh` + `/api/user/self` 读取
- `src/billing.ts`：额度快照解析、周期计算、Krill 账户数据与登录状态映射
- `src/syncLog.ts` / `src/components/SyncLogDialog.tsx`：浏览器侧日志上报与「同步日志」查看器
- `src/components/LoginDialog.tsx`：登录助手交互与轮询提示
- `src/auth.ts` / `src/components/LoginPage.tsx` / `src/components/AccountManager.tsx`：本地账号、登录页与管理员账号管理
- `src/ccSwitch.ts`：CC Switch 配置到应用供应商模型的映射
- `src/pages/Overview.tsx` / `Providers.tsx` / `Usage.tsx`
- `src/components/ProviderDrawer.tsx`：手动配置与只读接口额度视图
- `src/styles.css`：设计 token、组件与响应式样式

## 下一步建议

1. 定时同步与用量历史曲线
2. headless 空闲一段时间后自动退出，减少后台进程驻留
3. 支持 CC Switch 的 Claude / Gemini 配置导入
4. 自定义额度预警阈值与通知规则
5. 把本地 API Key 移入系统钥匙串或后端加密存储
6. 拆分 `ProviderDrawer.tsx`（约 1,300 行）、`vite-plugins/cc-switch.ts`（约 1,000 行）与 `styles.css`（约 5,100 行），并补上 vitest 与 lint
