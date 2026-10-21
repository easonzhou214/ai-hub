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
  - 额度卡片按风险排序：已过期 → 即将到期 → 额度紧张 → 需要登录 → 同步失败 / 待确认 → 正常
- **使用额度**
  - 按供应商拆分的累计用量构成
  - 周期额度、重置日期、账户余额、累计用量与同步状态明细
- **本地体验**
  - `localStorage` 持久化；通知中心；响应式布局
  - 导出配置不含 API Key；可恢复演示数据

## 启动

macOS 和 Windows 都可以直接双击项目根目录的启动脚本：

- macOS：**`start.command`**
- Windows：**`start.bat`**

脚本会：

- 自动查找 Node.js（macOS 优先使用 nvm 中的 Node 22.22.3；Windows 会检查 PATH 和常见安装位置）
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

> CC Switch 供应商的额度查询依赖本地 Vite 中间件：它会使用 CC Switch 中的 API Key 请求供应商额度接口，避免部分供应商后台接口没有 CORS 头的问题。把 `dist/` 静态部署到其他服务器时，CC Switch 导入与额度查询不可用（PixelLab 是浏览器直连，仍然可用），额度仍可手动维护。启动时若读不到 CC Switch 配置，会自动回退到演示数据。

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
- Krill Code 登录后读取 `/api/subscription` 的订阅/余额字段：`total_limit_usd`、`total_used_usd`、`total_remaining_usd`、`quota.window_reset_at` 与 `credit_balance_usd`
  - 有订阅套餐时展示周期额度，否则展示账户余额
- 网络接口失败保留旧数据；登录态失效时显示「需要登录」而不是伪造余额
- 不把「API Key 不限额」当成「账户不限额」
- 所有金额统一按美元展示；其他币种按 `$1 = ¥7.2` 折算仅用于演示数据

## 数据流与安全

1. 浏览器请求同源的 `/api/cc-switch/providers`、`/api/cc-switch/usage` 和 `/api/cc-switch/login/*`。
2. 本地 Vite 中间件以只读方式打开 `~/.cc-switch/cc-switch.db`，使用其中的 API Key 请求 New API 风格额度接口。
3. 对 Krill Code，本地服务启动独立的 Chrome 登录窗口；登录完成后通过 DevTools 协议在 Krill 页面内调用额度接口，JWT 不落 AI Hub 前端。
4. 浏览器不直接请求供应商后台；额度数据由本地服务转发。
5. 供应商配置与导入时得到的 API Key 会保存在当前浏览器 `localStorage`；导出的 JSON 会剔除 `apiKey`，只保留 `hasApiKey`。
6. 本地导入、额度查询与登录接口只接受 loopback 请求，并设置 `no-store`。

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
- `vite-plugins/cc-switch.ts`：本地只读 CC Switch 桥接 + 供应商额度查询代理 + 登录路由
- `vite-plugins/krill.ts`：独立 Chrome 登录窗口，Krill `/api/subscription` 与 Aixor `/api/user/auth/refresh` + `/api/user/self` 读取
- `src/billing.ts`：额度快照解析、周期计算、Krill 账户数据与登录状态映射
- `src/components/LoginDialog.tsx`：登录助手交互与轮询提示
- `src/ccSwitch.ts`：CC Switch 配置到应用供应商模型的映射
- `src/pages/Overview.tsx` / `Providers.tsx` / `Usage.tsx`
- `src/components/ProviderDrawer.tsx`：手动配置与只读接口额度视图
- `src/styles.css`：设计 token、组件与响应式样式

## 下一步建议

1. 补充手动录入账户额度的兜底方式（适合没有开放额度查询或登录被 Google 拦截的情况）
2. headless 空闲一段时间后自动退出，减少后台进程驻留
3. 定时同步与用量历史曲线
4. 支持 CC Switch 的 Claude / Gemini 配置导入
5. 自定义额度预警阈值与通知规则
6. 把本地 API Key 移入系统钥匙串或后端加密存储
