import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Krill Code / Aixor account login helper.
 *
 * Both providers expose account quota only to a browser login session, not to
 * the relay API key. A normal web page cannot read another origin's storage, so
 * we open a dedicated Chrome window, let the user finish login manually, and
 * query the provider's own account API from inside that page through the local
 * DevTools protocol. The password/Google session never reaches AI Hub.
 */

const HELPER_PORT = 9335
const PROFILE_DIR = join(process.cwd(), '.local', 'krill-login-profile')
const KRILL_ORIGIN = 'https://www.krill-code.com'
const LOGIN_URL = `${KRILL_ORIGIN}/app`
const TOKEN_KEY = 'krill_jwt'
const AIXOR_ORIGIN = 'https://aixor.org'
const AIXOR_LOGIN_URL = `${AIXOR_ORIGIN}/sign-in`

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((value): value is string => Boolean(value))

export interface KrillAccount {
  creditBalanceUsd: number | null
  lifetimeUsedUsd?: number | null
  planNames: string[]
  quotaTotalUsd: number | null
  quotaUsedUsd: number | null
  quotaRemainingUsd: number | null
  resetAt: string
  subscriptionEndAt: string
  cycle: 'week' | 'month'
}

/**
 * The helper browser could not be reached or the injected page request never
 * produced a usable response. This is NOT "the user is logged out": treating it
 * as an expired session used to flip cards to「需要登录」after a sleep, a Chrome
 * restart or a CDP timeout. Callers must keep the last known snapshot and
 * surface a retryable sync error instead.
 */
export class WebHelperUnavailableError extends Error {
  constructor(message = '登录助手浏览器暂时无法读取登录态') {
    super(message)
    this.name = 'WebHelperUnavailableError'
  }
}

interface PageTarget {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chromeBinary() {
  const binary = CHROME_PATHS.find((candidate) => existsSync(candidate))
  if (!binary) {
    throw new Error('找不到 Google Chrome，请先安装 Chrome')
  }
  return binary
}

async function cdpUp() {
  try {
    const response = await fetch(`http://127.0.0.1:${HELPER_PORT}/json/version`, {
      signal: AbortSignal.timeout(1200),
    })
    return response.ok
  } catch {
    return false
  }
}

async function listPages(): Promise<PageTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${HELPER_PORT}/json/list`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return []
    const data = (await response.json()) as unknown
    if (!Array.isArray(data)) return []
    return data
      .filter(
        (item): item is PageTarget =>
          Boolean(item) &&
          typeof item === 'object' &&
          (item as PageTarget).type === 'page' &&
          typeof (item as PageTarget).webSocketDebuggerUrl === 'string',
      )
      .map((item) => ({
        type: item.type,
        url: item.url,
        webSocketDebuggerUrl: item.webSocketDebuggerUrl,
      }))
  } catch {
    return []
  }
}

function isKrillPage(page: PageTarget) {
  try {
    const host = new URL(page.url).hostname
    return host === 'krill-code.com' || host.endsWith('.krill-code.com')
  } catch {
    return false
  }
}

function isAixorPage(page: PageTarget) {
  try {
    const host = new URL(page.url).hostname
    return host === 'aixor.org' || host.endsWith('.aixor.org')
  } catch {
    return false
  }
}

export type WebLoginProvider = 'krill' | 'aixor'

export function isKrillWebsite(websiteUrl: string, baseUrl: string) {
  try {
    const host = websiteUrl
      ? new URL(websiteUrl).hostname
      : new URL(baseUrl).hostname
    return host === 'krill-code.com' || host.endsWith('.krill-code.com')
  } catch {
    return /krill-code\.com/i.test(websiteUrl) || /krill-code\.com/i.test(baseUrl)
  }
}

export function detectWebLoginProvider(
  websiteUrl: string,
  baseUrl: string,
): WebLoginProvider | null {
  const haystack = `${websiteUrl} ${baseUrl}`
  if (isKrillWebsite(websiteUrl, baseUrl)) return 'krill'
  try {
    const host = websiteUrl
      ? new URL(websiteUrl).hostname
      : new URL(baseUrl).hostname
    if (host === 'aixor.org' || host.endsWith('.aixor.org')) return 'aixor'
  } catch {
    // Fall through to a string check.
  }
  return /aixor\.org/i.test(haystack) ? 'aixor' : null
}

async function ensureHelperWindow(initialUrl = LOGIN_URL) {
  if (await cdpUp()) return
  mkdirSync(PROFILE_DIR, { recursive: true })
  const binary = chromeBinary()

  // A dedicated profile is important: do not attach to the user's daily Chrome.
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    `--remote-debugging-port=${HELPER_PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    initialUrl,
  ]

  const child = spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(300)
    if (await cdpUp()) return
  }
  throw new Error('Chrome 登录窗口启动失败，请重试')
}

async function cdpSend(
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // ignore
      }
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => reject(new Error('读取登录态超时')))
    }, 3500)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method, params }))
    })
    socket.addEventListener('message', (event) => {
      let message: {
        id?: number
        result?: Record<string, unknown>
        error?: unknown
      }
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (message.id !== 1) return
      if (message.error) {
        finish(() => reject(new Error('读取登录态失败')))
        return
      }
      finish(() => resolve(message.result ?? {}))
    })
    socket.addEventListener('error', () => {
      finish(() => reject(new Error('无法连接登录窗口')))
    })
  })
}

let headlessLaunch: Promise<void> | null = null

/**
 * Start an invisible Chrome with the same persistent profile. This is used by
 * quota sync when the user has closed the visible login window; it lets the
 * app keep reading account data without requiring a Chrome window to stay open.
 */
async function ensureHeadlessHelper() {
  if (await cdpUp()) return
  if (!existsSync(PROFILE_DIR)) return
  if (headlessLaunch) return headlessLaunch
  headlessLaunch = (async () => {
    const binary = chromeBinary()
    const child = spawn(
      binary,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-crash-reporter',
        `--remote-debugging-port=${HELPER_PORT}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(300)
      if (await cdpUp()) return
    }
  })().finally(() => {
    headlessLaunch = null
  })
  return headlessLaunch
}

async function closeHelperBrowser() {
  if (!(await cdpUp())) return
  try {
    const versionResponse = await fetch(
      `http://127.0.0.1:${HELPER_PORT}/json/version`,
      { signal: AbortSignal.timeout(1500) },
    )
    if (versionResponse.ok) {
      const version = (await versionResponse.json()) as {
        webSocketDebuggerUrl?: string
      }
      if (version.webSocketDebuggerUrl) {
        await cdpSend(version.webSocketDebuggerUrl, 'Browser.close')
      }
    }
  } catch {
    // Best effort; fall through to waiting for the port.
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(200)
    if (!(await cdpUp())) return
  }
}

async function cdpEvaluate(
  webSocketDebuggerUrl: string,
  expression: string,
): Promise<unknown> {
  const result = await cdpSend(webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  })
  const nested = result.result as { value?: unknown } | undefined
  return nested?.value ?? null
}

async function cdpEvaluateAsync(
  webSocketDebuggerUrl: string,
  expression: string,
): Promise<unknown> {
  const result = await cdpSend(webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const nested = result.result as { value?: unknown } | undefined
  return nested?.value ?? null
}

async function bringKrillPageToFront(page: PageTarget) {
  try {
    await cdpEvaluate(page.webSocketDebuggerUrl, 'void 0')
  } catch {
    // Best-effort only.
  }
}

async function createTab(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const versionResponse = await fetch(
        `http://127.0.0.1:${HELPER_PORT}/json/version`,
        { signal: AbortSignal.timeout(2000) },
      )
      if (!versionResponse.ok) return false
      const version = (await versionResponse.json()) as {
        webSocketDebuggerUrl?: string
      }
      if (!version.webSocketDebuggerUrl) return false
      const result = await cdpSend(
        version.webSocketDebuggerUrl,
        'Target.createTarget',
        { url },
      )
      if (typeof result.targetId === 'string') return true
    } catch {
      await delay(400)
    }
  }
  return false
}

export async function isKrillHelperRunning() {
  return cdpUp()
}

export async function prepareAixorLogin() {
  await closeHelperBrowser()
  await ensureHelperWindow(AIXOR_LOGIN_URL)
  await delay(350)
  let pages = (await listPages()).filter(isAixorPage)
  if (pages.length === 0) {
    await createTab(AIXOR_LOGIN_URL)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(300)
      pages = (await listPages()).filter(isAixorPage)
      if (pages.length > 0) break
    }
  }
  if (pages.length === 0) throw new Error('无法打开 Aixor 登录窗口')
  const page = pages[0]
  try {
    await cdpSend(page.webSocketDebuggerUrl, 'Page.bringToFront')
  } catch {
    // Best effort.
  }
}

function parseAixorAccount(
  userPayload: unknown,
  statusPayload: unknown,
  subscriptionPayload?: unknown,
): KrillAccount {
  const user =
    userPayload && typeof userPayload === 'object'
      ? (((userPayload as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined) ?? (userPayload as Record<string, unknown>))
      : {}
  const status =
    statusPayload && typeof statusPayload === 'object'
      ? (((statusPayload as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined) ?? (statusPayload as Record<string, unknown>))
      : {}
  const perUnit = finiteNumber(status.quota_per_unit) || 500_000
  const quota = finiteNumber(user.quota)
  const used = finiteNumber(user.used_quota)
  const round = (value: number) => Math.round(value * 100) / 100

  const subscriptionRoot =
    subscriptionPayload && typeof subscriptionPayload === 'object'
      ? (((subscriptionPayload as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined) ?? (subscriptionPayload as Record<string, unknown>))
      : {}
  const subscriptionItems = Array.isArray(subscriptionRoot.subscriptions)
    ? (subscriptionRoot.subscriptions as Array<Record<string, unknown>>)
    : []
  const now = Date.now()

  const activeSubscriptions = subscriptionItems
    .map((item) =>
      item.subscription && typeof item.subscription === 'object'
        ? (item.subscription as Record<string, unknown>)
        : item,
    )
    .filter((item) => {
      if (item.status !== 'active') return false
      const end = finiteNumber(item.end_time)
      return end === null || end * 1000 > now
    })
    .sort(
      (a, b) =>
        (finiteNumber(b.end_time) ?? 0) - (finiteNumber(a.end_time) ?? 0),
    )

  let quotaTotalUsd: number | null = null
  let quotaUsedUsd: number | null = null
  let quotaRemainingUsd: number | null = null
  let resetAt = ''
  let subscriptionEndAt = ''
  let cycle: 'week' | 'month' = 'month'

  const active = activeSubscriptions[0]
  if (active) {
    const totalUnits = finiteNumber(active.amount_total)
    const usedUnits = finiteNumber(active.amount_used)
    if (totalUnits !== null && totalUnits > 0) {
      const total = totalUnits / perUnit
      const planUsed =
        usedUnits !== null ? Math.max(usedUnits / perUnit, 0) : 0
      quotaTotalUsd = round(total)
      quotaUsedUsd = round(planUsed)
      quotaRemainingUsd = round(Math.max(total - planUsed, 0))
    }
    const nextReset = finiteNumber(active.next_reset_time)
    const lastReset = finiteNumber(active.last_reset_time)
    if (nextReset !== null) resetAt = isoFrom(nextReset)
    else if (lastReset !== null) resetAt = isoFrom(lastReset + 7 * 86400)
    const end = finiteNumber(active.end_time)
    if (end !== null) subscriptionEndAt = isoFrom(end)
    if (nextReset !== null && lastReset !== null) {
      cycle = nextReset - lastReset >= 6 * 86400 ? 'week' : 'month'
    } else if (nextReset !== null) {
      cycle = 'week'
    }
  }

  return {
    creditBalanceUsd: quota === null ? null : round(quota / perUnit),
    lifetimeUsedUsd: used === null ? null : round(used / perUnit),
    planNames: [],
    quotaTotalUsd,
    quotaUsedUsd,
    quotaRemainingUsd,
    resetAt,
    subscriptionEndAt,
    cycle,
  }
}

async function requireHelperBrowser() {
  await ensureHeadlessHelper()
  if (!(await cdpUp())) {
    throw new WebHelperUnavailableError(
      '登录助手浏览器未启动，暂时无法读取登录态',
    )
  }
}

export async function readAixorAccountFromBrowser(): Promise<KrillBrowserAccount> {
  await requireHelperBrowser()
  await ensureAixorPageForReading()
  const pages = (await listPages()).filter(isAixorPage)
  if (pages.length === 0) {
    throw new WebHelperUnavailableError(
      '登录助手没有可用的 Aixor 标签页，暂时无法读取登录态',
    )
  }

  const expression = `(async () => {
    let token = window.__aihub_aixor_token || '';
    let refreshStatus = 0;
    let usedRefresh = false;

    const refreshToken = async () => {
      usedRefresh = true;
      try {
        const refresh = await fetch('/api/user/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        refreshStatus = refresh.status;
        let data = null;
        try { data = await refresh.json(); } catch {}
        token = data?.data?.access_token || '';
        if (token) window.__aihub_aixor_token = token;
      } catch {
        token = '';
      }
    };

    const request = async (url) => {
      try {
        const headers = {
          Accept: 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        };
        const response = await fetch(url, {
          credentials: 'include',
          headers,
        });
        let payload = null;
        try { payload = await response.json(); } catch {}
        return { status: response.status, payload };
      } catch {
        return { status: 0, payload: null };
      }
    };

    if (!token) await refreshToken();
    let user = await request('/api/user/self');
    if ((user.status === 401 || user.status === 403) && !usedRefresh) {
      window.__aihub_aixor_token = '';
      await refreshToken();
      user = await request('/api/user/self');
    }
    const [status, subscription] = await Promise.all([
      request('/api/status'),
      request('/api/subscription/self'),
    ]);
    return { user, status, subscription, hasToken: !!token, refreshStatus };
  })()`

  let pageFailed = false
  for (const page of pages) {
    try {
      const value = (await cdpEvaluateAsync(
        page.webSocketDebuggerUrl,
        expression,
      )) as
        | {
            user?: { status?: unknown; payload?: unknown }
            status?: { status?: unknown; payload?: unknown }
            subscription?: { status?: unknown; payload?: unknown }
          }
        | null
      if (!value) {
        pageFailed = true
        continue
      }
      const userStatus = Number(value.user?.status) || 0
      if (userStatus === 401 || userStatus === 403) {
        return { status: userStatus, account: null }
      }
      if (userStatus >= 200 && userStatus < 300) {
        return {
          status: userStatus,
          account: parseAixorAccount(
            value.user?.payload,
            value.status?.payload,
            value.subscription?.payload,
          ),
        }
      }
      if (userStatus === 0) {
        pageFailed = true
        continue
      }
      throw new Error(`Aixor 额度接口返回 HTTP ${userStatus}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Aixor 额度接口')) {
        throw error
      }
      pageFailed = true
      // Page may still be redirecting; try the next Aixor tab.
    }
  }
  throw new WebHelperUnavailableError(
    pageFailed
      ? '登录助手页面内请求失败，暂时无法读取 Aixor 登录态'
      : '登录助手暂时无法读取 Aixor 登录态',
  )
}

export async function prepareKrillLogin(resetSession = false) {
  await closeHelperBrowser()
  await ensureHelperWindow()
  await delay(350)
  const pages = await listPages()
  const krillPage = pages.find(isKrillPage)
  if (krillPage) {
    if (resetSession) {
      try {
        await cdpEvaluate(
          krillPage.webSocketDebuggerUrl,
          `(() => {
            try { localStorage.removeItem(${JSON.stringify(TOKEN_KEY)}); } catch {}
            try { document.cookie = ${JSON.stringify(`${TOKEN_KEY}=; Max-Age=0; path=/`)}; } catch {}
            return 'ok';
          })()`,
        )
        await cdpSend(krillPage.webSocketDebuggerUrl, 'Page.navigate', {
          url: LOGIN_URL,
        })
      } catch {
        // Keep the existing page; the user can still sign in there.
      }
    }
    await bringKrillPageToFront(krillPage)
  } else {
    await createTab(LOGIN_URL)
  }
}

let krillPageOpening: Promise<void> | null = null
let aixorPageOpening: Promise<void> | null = null

async function ensureKrillPageForReading() {
  if (krillPageOpening) return krillPageOpening
  krillPageOpening = (async () => {
    if (!(await cdpUp())) return
    const existing = (await listPages()).filter(isKrillPage)
    if (existing.length > 0) return
    await createTab(LOGIN_URL)
    for (let attempt = 0; attempt < 22; attempt += 1) {
      await delay(300)
      if ((await listPages()).some(isKrillPage)) {
        await delay(1800)
        return
      }
    }
  })().finally(() => {
    krillPageOpening = null
  })
  return krillPageOpening
}

async function ensureAixorPageForReading() {
  if (aixorPageOpening) return aixorPageOpening
  aixorPageOpening = (async () => {
    if (!(await cdpUp())) return
    const existing = (await listPages()).filter(isAixorPage)
    if (existing.length > 0) return
    await createTab(AIXOR_LOGIN_URL)
    for (let attempt = 0; attempt < 22; attempt += 1) {
      await delay(300)
      if ((await listPages()).some(isAixorPage)) {
        await delay(900)
        return
      }
    }
  })().finally(() => {
    aixorPageOpening = null
  })
  return aixorPageOpening
}

function finiteNumber(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isoFrom(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const number = Number(value)
    if (!Number.isFinite(number)) return ''
    const date = new Date(number > 1e12 ? number : number * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function parseKrillAccount(payload: unknown): KrillAccount {
  const root =
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined) ?? (payload as Record<string, unknown>)
      : {}
  const subscriptions = Array.isArray(root.subscriptions)
    ? (root.subscriptions as Array<Record<string, unknown>>)
    : []

  const planNames: string[] = []
  let total = 0
  let remaining = 0
  let used = 0
  let hasPlanQuota = false
  let cycle: 'week' | 'month' = 'month'
  const resetCandidates: number[] = []
  const endCandidates: number[] = []

  for (const subscription of subscriptions) {
    const plan =
      subscription.plan && typeof subscription.plan === 'object'
        ? (subscription.plan as Record<string, unknown>)
        : {}
    if (typeof plan.name === 'string' && plan.name.trim()) {
      planNames.push(plan.name.trim())
    }
    if (plan.billing_type === 'usd_weekly') cycle = 'week'

    const limit = finiteNumber(subscription.total_limit_usd)
    const available = finiteNumber(subscription.total_remaining_usd)
    const spent = finiteNumber(subscription.total_used_usd)
    if (limit !== null && limit > 0) {
      hasPlanQuota = true
      total += limit
      if (available !== null) remaining += available
      if (spent !== null) used += spent
    }

    const windowReset = isoFrom(
      (subscription.quota as Record<string, unknown> | undefined)
        ?.window_reset_at,
    )
    const endAt = isoFrom(subscription.subscription_end_at)
    if (windowReset) resetCandidates.push(new Date(windowReset).getTime())
    if (endAt) endCandidates.push(new Date(endAt).getTime())
  }

  const creditBalanceUsd = finiteNumber(root.credit_balance_usd)
  const quotaTotalUsd = hasPlanQuota ? Math.round(total * 100) / 100 : null
  let quotaRemainingUsd = hasPlanQuota
    ? Math.round(remaining * 100) / 100
    : null
  let quotaUsedUsd = hasPlanQuota ? Math.round(used * 100) / 100 : null
  if (hasPlanQuota && quotaUsedUsd === 0 && quotaRemainingUsd !== null) {
    quotaUsedUsd =
      Math.round(Math.max((quotaTotalUsd ?? 0) - quotaRemainingUsd, 0) * 100) /
      100
  }
  if (hasPlanQuota && quotaRemainingUsd === 0 && quotaUsedUsd !== null) {
    quotaRemainingUsd =
      Math.round(Math.max((quotaTotalUsd ?? 0) - quotaUsedUsd, 0) * 100) / 100
  }

  const futureResets = resetCandidates
    .filter((time) => Number.isFinite(time) && time > Date.now())
    .sort((a, b) => a - b)
  const futureEnds = endCandidates
    .filter((time) => Number.isFinite(time) && time > Date.now())
    .sort((a, b) => a - b)

  return {
    creditBalanceUsd:
      creditBalanceUsd === null
        ? null
        : Math.round(creditBalanceUsd * 100) / 100,
    planNames: [...new Set(planNames)],
    quotaTotalUsd,
    quotaUsedUsd,
    quotaRemainingUsd,
    resetAt: futureResets[0] ? new Date(futureResets[0]).toISOString() : '',
    subscriptionEndAt: futureEnds[0]
      ? new Date(futureEnds[0]).toISOString()
      : '',
    cycle,
  }
}

export interface KrillBrowserAccount {
  status: number
  account: KrillAccount | null
}

/**
 * Ask the logged-in Krill page to call its own dashboard API. Running the
 * request inside the page means the browser supplies the same JWT/cookies as
 * the real dashboard, without copying any credential to Node.
 */
export async function readKrillAccountFromBrowser(): Promise<KrillBrowserAccount> {
  await requireHelperBrowser()
  await ensureKrillPageForReading()
  const pages = (await listPages()).filter(isKrillPage)
  if (pages.length === 0) {
    throw new WebHelperUnavailableError(
      '登录助手没有可用的 Krill 标签页，暂时无法读取登录态',
    )
  }

  const expression = `(async () => {
    try {
      const jwt = localStorage.getItem(${JSON.stringify(TOKEN_KEY)}) || '';
      const response = await fetch('/api/subscription', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Language': 'zh-CN',
          ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
        },
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      return { status: response.status, payload };
    } catch (error) {
      return { status: 0, error: String(error) };
    }
  })()`

  let pageFailed = false
  for (const page of pages) {
    try {
      const value = (await cdpEvaluateAsync(
        page.webSocketDebuggerUrl,
        expression,
      )) as { status?: unknown; payload?: unknown } | null
      if (!value || typeof value !== 'object') {
        pageFailed = true
        continue
      }
      const status = Number(value.status) || 0
      if (status === 401 || status === 403) {
        return { status, account: null }
      }
      if (status >= 200 && status < 300) {
        return { status, account: parseKrillAccount(value.payload) }
      }
      if (status === 0) {
        pageFailed = true
        continue
      }
      throw new Error(`Krill 额度接口返回 HTTP ${status}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Krill 额度接口')) {
        throw error
      }
      pageFailed = true
      // Page may still be redirecting; try the next Krill tab.
    }
  }
  throw new WebHelperUnavailableError(
    pageFailed
      ? '登录助手页面内请求失败，暂时无法读取 Krill 登录态'
      : '登录助手暂时无法读取 Krill 登录态',
  )
}

export async function fetchKrillModelCount(
  baseUrl: string,
  apiKey: string,
): Promise<number> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  try {
    const response = await fetch(`${base}/models`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return 0
    const payload = (await response.json()) as {
      models?: unknown
      data?: unknown
    }
    if (Array.isArray(payload.models)) return payload.models.length
    if (Array.isArray(payload.data)) return payload.data.length
    return 0
  } catch {
    return 0
  }
}
