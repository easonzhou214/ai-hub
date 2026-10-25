# AI Hub 项目审计报告

审计日期：2026-10-23
范围：`src/`（16 个模块 + 3 个页面 + 12 个组件）、`vite-plugins/`（4 个模块）、构建与启动脚本
规模：源码 16,354 行，其中 `styles.css` 5,182 行（占 32%）
验证方式：全量通读 + 交叉引用计数 + `tsc --noEmit` + `npm run build`（均通过）

---

## 一、结论摘要

| 级别 | 问题 | 影响 |
|---|---|---|
| P0 | 启动失败时载入"演示数据"，冒充真实额度 | 新用户/静态部署下 8 个假供应商、假 Key、假"21 分钟前同步" |
| P0 | 编辑抽屉持有过期快照，保存会回滚刚同步的额度 | 静默数据回退，且清掉真实报错 |
| P0 | `runSync` 用旧数组整体覆盖，同步期间的开关/保存被丢弃 | 并发写丢失 |
| P0 | 管理员密码硬编码在前端包内，且账号随 `/api/state` 落盘 | 凭据公开，改密码会被自动重置 |
| P1 | 上游 `quota_display_type` 被丢弃，一律按 USD 渲染 | 人民币/Token 计费站点数字与单位全错 |
| P1 | `unlimited` 半实现：上游标志存进 `keyUnlimited`，UI 只读 `unlimited` | 不限额度账户显示 0/0 或"额度耗尽" |
| P1 | 跨设备"删除"会被本地缓存合并复活 | 删了又回来 |
| P2 | 额度渲染状态机复制 4 份、弹层外壳 5 份、重试逻辑 2 份 | 已经出现口径漂移（4 处显示不一致） |

---

## 二、无用 / 垃圾代码

### 2.1 演示数据接在生产路径上（最该先清）

`src/data.ts` 的 `createSeedProviders()` 生成 8 个供应商：`apiKey: 'sk-ant-demo-9f3c2a'`、`successRate: 0.98x`、`callsToday` 合计 1805、`expiresAt` 三天后，`createSeedSyncedAt()` 固定返回"21 分钟前"。

`src/App.tsx:302-308` 首次启动拉 CC Switch 失败就整份塞进去：

```ts
} catch {
  setProviders(createSeedProviders())
  setLastSyncedAt(createSeedSyncedAt())
  notify('未读取到 CC Switch 配置，已载入演示数据')
}
```

静态部署（`/api` 404）或没装 CC Switch 的机器，用户第一眼看到的是"今日调用 1,805 / 成功率 99.4% / 1 个即将到期"——全部凭空生成，且时间戳永远新鲜。`App.tsx:509-525` 的"重置为演示数据"是明示入口，可以留；启动兜底这条路径应该改成空态。

### 2.2 每分钟在编造用量

`src/App.tsx:85-112` 的 `simulateProviderUpdate()`：对不做接口同步的供应商，每次同步随机加 `callsToday`、随机扣 `balance`、随机加 `quotaUsed`（`quotaTotal * (0.8%~1.8%)`）。

`src/App.tsx:626` 每轮 `runSync` 都会调它——手动点同步、5 分钟自动同步、唤醒后自动同步，全部命中。它还会把 `updatedAt` 改成当前时间，于是界面上"上次同步 x 分钟前"是真的，"数据"是假的。这一条和 2.1 是同源问题：项目早期靠假数据撑演示，后来接了真接口但模拟器没拆。

### 2.3 确认无人引用的代码

| 位置 | 说明 |
|---|---|
| `src/billing.ts:586` `isSyncedProvider` | 零引用，且实现漏了 `pixellab`（正确的是 `utils.ts:82 isInterfaceSynced`）——留着就是个陷阱 |
| `src/billing.ts:616` `isUnlimitedProvider` | 零引用 |
| `src/billing.ts:394` `parsePixellabSnapshot` | 只有本文件用，不需要 `export` |
| `src/utils.ts:130` `formatMonthDay` | 零引用；`Usage.tsx:781 resetText` 又自己写了一份 |
| `src/utils.ts:119` `daysUntil` | 只有本文件内部用 |
| `src/auth.ts:42` `hashPassword` | 只有本文件内部用（导出无意义） |
| `vite-plugins/usage-cache.ts` `listUsageSnapshots` | 零引用（上次提交留下的） |
| `vite-plugins/krill.ts` `fetchKrillAccount` / `readKrillJwt` / `KrillLoginExpiredError` | 只有本文件内部用 |

### 2.4 写进去再从没被读的字段（半成品）

- `Provider.keyUnlimited`：`billing.ts:493/518/536` 从上游 `token.unlimitedQuota` 抄进来，一路透传到 `ProviderDrawer.tsx:383`，但**没有任何地方读它**。UI 判断的是 `provider.unlimited`，而 `billing.ts` 所有快照都硬编码 `unlimited: false`（282/300/338/364/381/399/491/516/534 九处）。结果：真正 `unlimited_quota: true` 的账户，首页卡片会走进 `available = 0` 分支。
- `Provider.note`（`types.ts:51`）：只在抽屉里编辑，任何页面都不展示。
- `Provider.createdAt`：只在两处原样搬运，从不展示。
- `billing.ts:37 displayType` / `totalGranted`、`billing.ts:65-70 subscriptionEndAt` / `planNames`、`pixellab.ts:67 planStatus`、`ccSwitch.ts:11-12 apiFormat` / `isCurrent`、`codex.ts:4-14` 的 6 个字段：声明、写入，从不消费。

### 2.5 死 CSS

`styles.css` 里以下类名在整个 `src/` 的 `.tsx/.ts` 中零出现（动态拼接的 `progress-${tone}`、`tone-${tone}`、`status-badge ${status}` 已人工排除，不算死代码）：

- `.sync-chip` / `.sync-chip svg`（3524、3541）
- `.pt-mini-tag` / `.pt-mini-tag.balance`（1802、1812）
- `.provider-group-image .provider-group-dot`（1445）
- `.logo-sm` / `.logo-lg`
- `.is-warn`、`.w3`、`.org` 等零散规则

量不大（约 60 行），但和 2.1/2.2 是同一类问题：功能删了，样式留着。

### 2.6 过时的注释与版本号

- `src/auth.ts:1-7` 开头写"这个构建没有服务端：账号、会话都只存在当前浏览器的 localStorage 里"——现在账号会随 `/api/state` 写到 `hubState`/服务端 JSON，注释已经不成立。
- `package.json` version `0.2.0`，但 `vite-plugins/cc-switch.ts` 的请求头写死 `User-Agent: AI-Hub/0.3 (local quota reader)`，README 里写 v0.2。
- README「下一步建议」第 1 条是"补充手动录入账户额度的兜底方式"，而抽屉早就有手动额度/余额录入。

---

## 三、重复

### 3.1 额度渲染状态机 4 份（已漂移）

同一套 `needsLogin → noData → unknown → hasAccountBalance → percent` 分支树：

| 文件 | 行范围 |
|---|---|
| `components/ProviderCard.tsx` | 96-207 |
| `components/ProviderDrawer.tsx` | 686-788 |
| `pages/Providers.tsx` | 368-464 |
| `pages/Usage.tsx` | 630-720 |

钱包余额那一行抄了 3 份（`ProviderCard.tsx:209-217`、`Providers.tsx:459-464`、`Usage.tsx:685-690`），`unlimited-bar is-login/is-error/is-unknown` 三种占位条也抄了 3 份。

**已经漂移的证据**：`Providers.tsx` 有 `hasBoth`，`ProviderCard.tsx` 没有；`ProviderCard` 漏掉 `unlimited` 分支，所以不限额度供应商在概览页显示"剩余 $0.00"，在列表页显示"不限额度"。

### 3.2 派生视图模型 3 份

`Providers.tsx:270-285`、`Usage.tsx:508-524`、`ProviderCard.tsx:48-63` 各自算一遍 `hasPlanQuota / hasWallet / hasAccountBalance / noData / cumulative / lastSync`。真正的业务语义（什么叫"读取失败"、钱包和周期额度怎么共存）有三份独立定义。

### 3.3 弹层外壳 + Esc 监听 5 份

`Overlays.tsx:21-45`、`LoginDialog.tsx:21-42`、`SyncLogDialog.tsx:85-107`、`AccountManager.tsx:45-108`、`ProviderDrawer.tsx:202-435`。行为还不一致：只有 `ProviderDrawer` 锁 body 滚动，`SyncLogDialog` / `LoginDialog` 不设初始焦点。

### 3.4 其他成对/三份的实现

- **fetch 重试**：`billing.ts:245-259` 与 `pixellab.ts:164-178` 两套（`sleep`/`networkAvailable` 也一字不差各一份）。
- **金额格式化**：`utils.ts:66-69`、`utils.ts:106-109`、`utils.ts:73` 三处同样的 `toLocaleString` 配置。
- **错误文案**：`billing.ts:85-87`、`ccSwitch.ts:46-50`、`syncLog.ts:31` 把"本地服务不可用"写成三种说法。
- **阈值**：`utils.ts:290/297`（80/100）、`components/ui.tsx:46-51`（80/90）、`utils.ts:413`（80）三处"紧张"定义。
- **类型映射表**：`utils.ts:17-20`、`Usage.tsx:40-43`、`ProviderDrawer.tsx:71-74` 三张同域表。
- **字段重复**：`ProviderDrawer.tsx:956-967` 与 `1029-1040`（币种下拉逐字相同）、`996-1010` 与 `1073-1088`（到期日期）。
- **日期/首字母**：`AccountManager.tsx:8-21` 自己写了一份，`utils.ts:137` 和 `TopBar.tsx:78` 已有。

---

## 四、隐藏 bug（按严重度）

### P0-1 编辑抽屉持有过期快照，保存回滚新数据

`App.tsx:404-409` 只在打开时 `setEditing(provider)`，之后同步只会更新 `providers`，`editing` 永远指向打开那一刻的对象。而 `ProviderDrawer.tsx:270-274` 与 `:385-389` 用 `provider?.quotaTotal / quotaUsed / balance / accountBalance / lastSyncedAt` 拼 draft，`handleSave`（`App.tsx:426-432`）用 draft 整体替换。

抽屉开着、5 分钟自动同步跑完 → 用户点保存 → 额度退回旧值，`syncError` 还被 `:389` 的 `syncError: ''` 抹平。**建议**：`editing` 用 id 存，渲染时从 `providers` 里取最新对象；或者保存时只合并"用户可编辑字段"。

### P0-2 `runSync` 用快照整体覆盖

`App.tsx:606-629`：

```ts
const updated = await Promise.all(providers.map(...))
setProviders(updated)     // providers 是函数开始时的快照
```

同步要几秒，期间用户 `handleToggle`（:471）或 `handleSave`（:416）用的是函数式更新，写进去了，然后被 `updated` 整体盖掉。**建议**：合并时按 id 取 current 里 `updatedAt` 更新的那条。

### P0-3 管理员密码硬编码 + 改密码无效

`src/auth.ts:34-36`：`ADMIN_PASSWORD = 'bob215921'`。`getAccounts()`（:101-138）每次调用都把管理员记录的 `passwordHash` 强制改写回这个值，所以管理员改密码 → 下次任何读取又变回去。同时账号数组含 `passwordHash`，会随 `/api/state` 写进 `.local/hub-state.json`。

这是"个人本机工具"的取舍可以理解，但至少应：① 把凭据挪到构建期注入或首次启动生成；② 明确"管理员密码不可改"或允许改。

### P0-4 `/api/state` 的 revision 乐观锁有竞态

`state-store.ts:154-220`：`const stored = readState()` 在请求一开始就读，`baseRevision` 与它比较；写盘是 `queueWrite` 串行的，但**比较用的是读时的快照**。两台设备同时 PUT，都读到 revision=5、都通过校验、都写 revision=6，后写的覆盖前写的——409 保护在这条路径上失效。

**建议**：把 `read → compare → write → 递增` 整段放进 `queueWrite` 的串行队列里。

### P1-1 币种与单位被丢弃

`billing.ts:37` 声明了 `displayType`，全仓无引用；`billing.ts:564-565` 任何同步成功都强制 `billing: 'quota'`、`currency: 'USD'`；`ccSwitch.ts:89-90` 导入时也写死 USD。上游 `quota_display_type` 为 CNY / TOKENS / CUSTOM 的站点，金额和符号全错，而 `Usage.tsx:366` 还宣称"按 $1=¥7.2 折算"。

### P1-2 `unlimited` 半实现（见 2.4）

`billing.ts` 九处 `unlimited: false` + 上游标志存在 `keyUnlimited` 且无人读 = 不限额度账户在 `getQuotaState`（`utils.ts:182`）里被当成 `quotaTotal <= 0`，走进 `utils.ts:233-253`，`used` 被 `clamp(x, 0, 0)` 压成 0，最终显示"已用 $0.00 / $0.00"（`Providers.tsx:455`）。

### P1-3 跨设备删除会被"复活"

`hubState.ts:77-92 mergeProviders()`：首次加载把"服务端 + 本地缓存"按 id 取并集，本地独有的保留并推回服务端。A 设备删掉某供应商，B 设备还留着旧缓存 → B 下次打开就把它合并回来并覆盖服务端。目前只对"新增"友好，对"删除"是反的。

### P1-4 重新导入清空手填的到期日

`ccSwitch.ts:95-96` 把 `resetAt: ''`、`expiresAt: ''` 写死，虽然调用方传了 `existing`，但这两个字段没有取 `existing?.expiresAt`；后续 `applyBillingSnapshot` 只补 `resetAt`，从不补 `expiresAt`。用户在抽屉里手填的到期日，一次"从 CC Switch 导入"就永久丢失。

### P1-5 PixelLab：`null` 被当成 0

`pixellab.ts:133-137`：

```ts
const finite = (value: unknown) => {
  const num = Number(value)   // Number(null) === 0，Number('') === 0
  return Number.isFinite(num) ? num : undefined
}
```

而 `BalancePayload`（:52-58）明确允许 `usd?: number | null`。上游给 `null`（无订阅/无余额字段）时被解释成 0，`billing.ts:415` 判"无订阅"→ `accountBalance: 0` → `getStatus`（`utils.ts:292`）判成**额度耗尽**。

### P1-6 负余额未夹取

`billing.ts:342-345` 的 `accountBalance` 直接 `roundMoney(account.creditBalanceUsd)`，没有 `Math.max(…, 0)`；同项目 `pixellab.ts:145` 是夹取过的。负值会进 `Overview` 的 `sumInUSD` 和 `Usage` 的 donut（`Usage.tsx:197-206` 的 `donutCursor` 会生成 `start > end` 的 conic 段）。

### P2 级零散 bug

| 位置 | 问题 |
|---|---|
| `Usage.tsx:760` | `className={cx(expiry && 'ut-expiry')}`，`expiry` 是字符串，非空时 className 直接变成"3 天后到期"，样式从未生效 |
| `ProviderDrawer.tsx:135` | `balance: provider.balance ? String(...) : ''`，余额为 0 打开就是空输入框，保存报"请填写有效的当前余额" |
| `ProviderDrawer.tsx:1207-1210` | 开关用 `!form.enabled` 闭包取值，同文件 `:1109` 用的是函数式更新，快速连点会"点两下不动" |
| `AccountManager.tsx:45-56` | effect 依赖里含 `confirm` 与内联 `onClose`，每次父组件渲染都重排 80ms 聚焦定时器，用户输入时光标会被拽回用户名框；删除确认时还会抢走 `ConfirmDialog` 的焦点 |
| `ProviderDrawer.tsx:206` + `LoginDialog.tsx:23` | 两个 Esc 监听同时挂在 document，"抽屉里点登录"时按一次 Esc 会同时关掉两者，未保存的改动一起丢 |
| `billing.ts:88-101` | `readableSyncError` 先匹配"含中文就原样返回"，后面的 `/超时/` 分支永远不可达 |
| `billing.ts:153-156` | `toCycle('daily')` 返回 `'month'`，日额度账户显示"每月重置" |
| `billing.ts:167` | `setMonth(+1)` 对 1/31 会滚到 3/3，月末账单周期跳月 |
| `billing.ts:229-233` | 成功响应不校验形状，`token` 缺失时把 `Cannot read properties of undefined` 透给用户 |
| `utils.ts:253-262` | "本月预算"分支 `available` 返回的是钱包 `balance` 而不是 `budget - spend`，告警文案因此自相矛盾 |
| `utils.ts:296-299` | `billing:'balance'` + `balance: 0` 判 `healthy`（显示"余额 ¥0.00 + 正常"），而 `accountBalance: 0` 判 `exhausted`——两个"余额"零值语义相反 |
| `Usage.tsx:317-323` | 待关注计数把 `unknownCount` 与各 status 相加，同一供应商可能被计两次，与概览页数字不一致 |
| `utils.ts:151-152` | `relativeTime` 对未来时间返回"刚刚" |
| `types.ts` + `utils.ts:65` | 所有金额声明为必填 `number`，运行时只有 `App.tsx:66-79` 校验 id/name/type；老数据缺字段 → NaN → `formatMoney` 显示 $0.00 → `getStatus` 判 `healthy`（把损坏数据伪装成正常） |

---

## 五、目录与结构问题

### 5.1 `src/` 扁平 15 个模块，职责层次不清

现状：`billing / auth / hubState / ccSwitch / codex / pixellab / syncLog / syncSources / data / utils / types / icons` 全平铺在 `src/` 根下，`components/` 与 `pages/` 各一层。`utils.ts` 一个文件承担 7 类职责（常量、cx/clamp、金额格式化、日期、额度状态机、文案映射、告警规则引擎）。

建议分层（不动业务代码，只移动 + 改 import）：

```
src/
  domain/      types.ts、quotaRules.ts（getQuotaState/getStatus/providerAlerts）、providerView.ts（新：统一视图模型）
  services/    billing.ts、pixellab.ts、ccSwitch.ts、codex.ts、hubState.ts、auth.ts、syncLog.ts
  ui/          components/**、pages/**、styles/**
  dev/         data.ts（演示种子，仅 dev 入口引用）
```

### 5.2 `styles.css` 5,182 行单文件

已有 22 个分区注释，可以按分区拆成 `styles/` 目录（tokens / shell / topbar / sidebar / cards / pages / drawer / modal / auth / responsive）。注意：`Responsive` 分区从 4059 开始，但后面又追加了 `Overview rhythm`(4770)、`Auth`(4795)、`Account manager`(4914) 三个新分区——**响应式规则被后加的分区打断**，拆的时候顺手把媒体查询收拢。

### 5.3 `ProviderDrawer.tsx` 1,316 行

边界很清楚：纯函数区（36-156，约 120 行）→ 表单状态与校验（158-421）→ 01 基本信息（480-609）→ 02 额度（611-1094，其中自动/手动两棵互斥子树各约 200 行）→ 03 凭证（1096-1191）→ 04 状态备注（1193-1244）→ `Field`/`MoneyInput`（1251-1316，通用原子组件，被 3 个文件重复实现）。

顺带一个证据：`ProviderDrawer.tsx:858` 与 `:1092` 的缩进比同级少两级，说明手动额度那 236 行是从别处粘进来的。

### 5.4 `vite-plugins/cc-switch.ts` 1,037 行 / 8 个路由

`readCcSwitchProviders` / `readCodexCurrent` / TOML 解析 / 余额适配器 / usage 重试 / 登录 start+status / 日志读取 / 客户端日志上报全在一个文件。至少可拆 `routes/`、`cc-switch-db.ts`、`codex-config.ts`、`usage-adapters.ts`。

### 5.5 工程化缺口

- **没有测试**。`getQuotaState`、`applyBillingSnapshot`、`parseUsagePayload`、`mergeProviders` 全是纯函数，最适合先补 vitest。
- **没有 lint 配置**。全仓只有 1 处 `eslint-disable`（`App.tsx:383`），但没有 eslint 依赖和规则文件，`npm run build` 只有 `tsc --noEmit`。
- **`start.bat` 与 `start.command` 逻辑重复**（各约 3KB，Node 版本检查、端口占用检测各写一遍）。
- `package.json` 无 `test`/`lint` 脚本，无 `engines` 之外的运行时约束说明（`node:sqlite` 需要 ≥22.13，README 有写，但 npm 不会拦）。

---

## 六、建议的清理顺序

1. **先拆假数据**：`App.tsx:302-308` 改成空态 + 引导；删掉 `simulateProviderUpdate`（或加 `import.meta.env.DEV` 守卫）。改动小、收益最大。
2. **修 P0 数据回退**：抽屉按 id 取最新 provider；`runSync` 合并而非覆盖。这两条不修，用户改的东西随时可能被吞。
3. **P0 安全**：管理员密码移出源码；`state-store` 的 CAS 放进串行队列。
4. **统一视图模型**：抽 `describeProvider(provider)`，四个渲染器只消费结果——一次性消掉第 3.1/3.2 的重复和漂移。
5. **补 unlimited / 币种**：让 `keyUnlimited → unlimited` 真正生效，把 `displayType` 接进 `currency`。
6. **再做结构迁移**：目录分层、CSS 拆分、`ProviderDrawer` 拆文件、补 vitest。这些是纯工程收益，放最后做不影响功能。

---

## 七、已排查、确认没有问题的点

- `JSON.parse` 全部有 try/catch（`billing:195`、`pixellab:114`、`ccSwitch:54`、`syncLog:39`、`codex:22`、`state-store:140`）。
- 数组排序全部 `[...list].sort(comparator)`，无原地排序污染、无字典序误用。
- 除法处均有 `> 0` 守卫（`compositionTotal`、`total`、`monthlyBudget`、`calls`）。
- 定时器/监听器：除 `ProviderDrawer.tsx:322` 那个 140ms 滚动定位，其余都有清理。
- 受控组件：所有 `input/select/textarea` 都有 `value + onChange`；三个表单都有 `preventDefault`。
- `tsc --noEmit`（`noUnusedLocals` / `noUnusedParameters` 全开）与生产构建均通过，`vite-plugins/` 通过 `vite.config.ts` 的 import 被传递检查。

---

## 八、本轮修复记录

### 8.1 演示数据（整块删除）

- 删除 `src/data.ts`；`App.tsx` 不再有 `createSeedProviders` / `createSeedSyncedAt` / `simulateProviderUpdate` / `roundMoney`
- 启动兜底改为**空态**：读不到 CC Switch 时只弹一条错误通知，界面保持 0 供应商
- 头像菜单去掉「重置演示数据」，`TopBar` 的 `onReset` prop 一起删掉；账号弹层里的「管理员 · 本地演示模式」改成「管理员 · 全部权限」
- 顺带把启动流程改成**不阻塞**：导入配置后立即进界面，额度交给自动同步在后台补（此前要等所有供应商（含拉起 headless Chrome 的 Krill / Aixor）同步完，启动页会停几十秒）

### 8.2 P0

| 问题 | 处理 |
|---|---|
| 抽屉持有过期快照 | `editing` 改成 `editingId`，渲染时从 `providers` 里取最新对象；供应商被删除时自动关抽屉 |
| `runSync` 整体覆盖 | 先记录 `baseVersions`（各供应商 `updatedAt`），再按 id 合并：只有 `updatedAt` 没变过的才接受同步结果 |
| 管理员密码 `getAccounts()` 强制回写 | 只在缺记录时才用引导口令创建，已有记录保留摘要；新增「修改密码」表单 |
| `/api/state` 乐观锁竞态 | `handleState` 的「读 → 比对 baseRevision → 写」整体放进 `withStateLock` 临界区 |

### 8.3 P1

- **币种**：`parseUsagePayload` 按 `quota_display_type` 推出 `currency`，`applyBillingSnapshot` 写回；`Provider.currency` 真正生效（USD / CNY）
- **unlimited**：`applyBillingSnapshot` 由 `keyUnlimited && quotaTotal <= 0 && accountBalance === undefined` 推导，不再硬编码 `false`
- **跨设备复活**：`hubState` 删掉 `mergeProviders`；服务端有数据就整份采用，只在服务端为空时把本地缓存迁移上去
- **到期日丢失**：`ccSwitch` 重新导入时保留 `expiresAt` / `resetAt` / `cycle` / `syncError`
- **PixelLab `null` 当 0**：`finite()` 对 `null` / `''` 直接返回 `undefined`
- **负余额**：账户余额按 `Math.max(…, 0)` 夹取

### 8.4 P2 零散

- `cx(expiry && 'ut-expiry')` → `cx(expiry ? 'ut-expiry' : undefined)`
- 抽屉里余额为 0 时不再变成空输入框；开关改函数式更新
- `AccountManager` / 抽屉 / 三个弹层统一用 `useEscapeKey` + `useInitialFocus`，聚焦不再被父组件渲染重置；抽屉开着登录弹层时 `escapeDisabled`，Esc 只关最上层
- `readableSyncError` 去掉永远不可达的分支；`toCycle('daily')` 返回 `day` 并补了「每天重置」选项；`addMonth` 处理 1/31 溢出；成功响应加 `isUsagePayload` 形状校验与 20s 超时
- 「本月预算」`available` 改成 `budget - spend`；`billing:'balance'` 且余额 0 判 `exhausted`
- `Usage` 的「需要关注」按供应商去重；`relativeTime` 对未来时间不再一律「刚刚」

### 8.5 重复与尸体

- 新增 `src/providerView.ts`：`describeProvider()` 统一「额度 / 余额 / 状态 / 到期 / 登录态」，卡片、列表、总览三处渲染器只消费结果（消掉 3.1 / 3.2 的 4 份状态机与 3 份派生逻辑）
- 新增 `src/net.ts`：`withRetry` + `sleep` + `networkAvailable`，`billing.ts` 与 `pixellab.ts` 共用（原两份逐字相同）
- 新增 `src/hooks.ts`：`useEscapeKey` / `useInitialFocus`
- 阈值收口到 `utils.ts`：`QUOTA_WARN_PERCENT` / `QUOTA_EXHAUSTED_PERCENT` / `BAR_DANGER_PERCENT` / `LOW_BALANCE_AMOUNT` / `EXPIRING_SOON_DAYS`
- 金额与次数的 `toLocaleString` 收成一个 `groupNumber`；`formatFullDate` 支持分隔符，`initialOf` 统一首字母
- 删除死导出：`billing.isSyncedProvider` / `isUnlimitedProvider` / `parsePixellabSnapshot` 的 `export`、`usage-cache.listUsageSnapshots`、`krill.fetchKrillAccount` / `readKrillJwt` / `KrillLoginExpiredError` / `SUBSCRIPTION_URL`
- 删除死 CSS：`.sync-chip*`、`.pt-mini-tag*`、`.provider-group-image .provider-group-dot`、`.logo-sm` / `.logo-lg`、`.storage-chip*` 与遗留的 900px 媒体查询
- 版本号：`User-Agent` 改为从 `package.json` 读，`package.json` 升到 `0.3.0`；`tsconfig.include` 补上 `vite-plugins`（此前插件目录完全没被类型检查，现在 5 个文件都在检查范围内）
- `.workbuddy/` 加入 `.gitignore`

### 8.6 本轮未做（保留在「下一步建议」）

- 目录分层（`domain / services / ui`）
- `styles.css` 拆分 + 媒体查询收拢
- `ProviderDrawer.tsx`（约 1,300 行）、`vite-plugins/cc-switch.ts`（约 1,000 行）拆文件
- `start.bat` / `start.command` 合并逻辑
- vitest 与 eslint

这些是纯工程改造，不影响当前功能，单独一轮做更安全。

## 九、补充修复：「同步提示成功但没同步」

现象：在别的设备上打开页面点「同步额度」，提示成功、数字没变。追查后确认是三个问题叠在一起：

1. **「上次同步」在失败时也被写成当前时间**。`runSync` 无条件 `setLastSyncedAt(now)`，HUD 常驻显示「上次同步 刚刚」，toast 又只活 2.8 秒，所以看到的是「成功」而数据没动。现在只有 `realSynced > 0` 才写；失败只更新卡片上的 `syncError`。自动同步的重试因此改用内存里的 `lastAttemptRef` + 60s 冷却节流。
2. **`200 + loginRequired` 被算成同步成功**。网页登录态过期时接口仍返回 200，`fetchProviderBilling` 正常 resolve，`realSynced` 就 +1。现在这类结果单列成 `needLogin`，提示改成「X 的登录态已过期」，不再混进成功数；导入流程 `syncImportedProviders` 同理。
3. **客户端根本调不到接口，界面却没提示**。`/api/cc-switch/*` 在 `cc-switch.ts` 里用 `isLoopback(request)` 做了限制，非本机一律 403（`/api/state` 不受限，所以列表能显示、只有同步失败）。现在：

   - 新增 `vite-plugins/runtime.ts` → `GET /api/runtime`，按连接来源判断 `role: server | client`，带上主机名、局域网地址、`syncFromClient`；
   - 前端 `src/runtime.ts` + `useRuntimeInfo()`，据此置灰「同步额度」「从 CC Switch 导入」「网页登录」，并在 title/账号菜单里写明「在本机执行」还是「在服务器 xxx 上执行」；
   - 需要放开的场景（局域网自用）用 `AIHUB_ALLOW_REMOTE_SYNC=1` 启动，`vite-plugins/remote-access.ts` 统一读这个开关，`/api/runtime` 的 `syncFromClient` 会同步变化。

顺带修掉两处会误导人的文案：侧边栏写死的「本地优先 · 仅存本机」改成按 `storageMode` 显示「服务端存储 · 多端共用 / 本机存储 · 未连接服务端」；账号浮层写死的 `AI Hub v0.2` 改成 `__APP_VERSION__`（来自 `package.json`）。`fetchCcSwitchProviders` 现在把服务端返回的 `error` 原样透出，不再是笼统的「无法读取 CC Switch 配置」。
