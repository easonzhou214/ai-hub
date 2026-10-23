import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Plugin } from 'vite'
import pkg from '../package.json'
import {
  detectWebLoginProvider,
  fetchKrillModelCount,
  isKrillHelperRunning,
  prepareAixorLogin,
  prepareKrillLogin,
  readAixorAccountFromBrowser,
  readKrillAccountFromBrowser,
  WebHelperUnavailableError,
  type WebLoginProvider,
} from './krill'
import { logSyncEvent, readSyncEvents, SYNC_LOG_DIR } from './sync-log'
import { getUsageSnapshot, saveUsageSnapshot } from './usage-cache'

/**
 * Local-only bridge to CC Switch, Codex's active provider, and quota endpoints.
 *
 * - GET  /api/cc-switch/providers  -> custom Codex providers in CC Switch
 * - POST /api/cc-switch/usage      -> token/account quota for one provider
 * - GET  /api/codex/current        -> provider currently used by the Codex app
 *
 * All endpoints are restricted to loopback requests. Provider credentials
 * never leave the machine; the browser never has to call provider admin APIs
 * directly (some of those do not expose CORS headers).
 */

const PROVIDERS_PATH = '/api/cc-switch/providers'
const USAGE_PATH = '/api/cc-switch/usage'
const LOGIN_START_PATH = '/api/cc-switch/login/start'
const LOGIN_STATUS_PATH = '/api/cc-switch/login/status'
const CODEX_CURRENT_PATH = '/api/codex/current'
const LOGS_PATH = '/api/cc-switch/logs'
const CLIENT_LOG_PATH = '/api/cc-switch/log'
const DB_PATH = join(homedir(), '.cc-switch', 'cc-switch.db')
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml')
const REQUEST_TIMEOUT_MS = 12_000
const SYNC_ATTEMPTS = 3
const RETRY_DELAYS_MS = [500, 1_500]
/** 与 package.json 保持一致，避免请求头里写死的版本号再次漂移。 */
const APP_VERSION = pkg.version

export interface CodexCurrentSnapshot {
  available: boolean
  providerId: string
  name: string
  baseUrl: string
  model: string
  profile: string
  /** CC Switch row that matches this Codex config, if any. */
  sourceId: string | null
  official: boolean
  error?: string
}

export interface CcSwitchProvider {
  sourceId: string
  name: string
  appType: string
  baseUrl: string
  apiKey: string
  model: string
  apiFormat: string
  isCurrent: boolean
  websiteUrl: string
}

interface CcSwitchResponse {
  available: boolean
  providers: CcSwitchProvider[]
  error?: string
}

interface TokenQuotaPayload {
  quotaPerUnit: number
  displayType: string
  token: {
    quotaLimit: number | null
    quotaPeriodStart: number | null
    quotaResetPeriod: string | null
    totalAvailable: number | null
    totalGranted: number | null
    totalUsed: number | null
    unlimitedQuota: boolean
    userQuota: {
      totalAvailable: number | null
      totalUsed: number | null
    } | null
  }
  modelCount: number
  source: 'token-usage'
  fetchedAt: string
}

function isLoopback(request: IncomingMessage) {
  const address = request.socket.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorCauseCode(error: unknown): string {
  if (!(error instanceof Error)) return ''
  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return ''
  const record = cause as { code?: unknown; name?: unknown }
  if (typeof record.code === 'string') return record.code
  if (typeof record.name === 'string' && record.name !== 'Error') {
    return record.name
  }
  return ''
}

function describeSyncError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || '未知错误',
      code: errorCauseCode(error),
    }
  }
  return { message: String(error) || '未知错误', code: '' }
}

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'TimeoutError',
  'AbortError',
])

/**
 * Only retry conditions that can plausibly heal in a second or two: dropped
 * connections, DNS hiccups, upstream 5xx/429 and browser helper timeouts.
 * Auth/config errors (401/404/missing quota endpoint) are returned immediately.
 */
function isRetryableSyncError(error: unknown) {
  // A missing/frozen helper browser is transient: retry instead of treating it
  // as an expired login.
  if (error instanceof WebHelperUnavailableError) return true
  const { message, code } = describeSyncError(error)
  if (RETRYABLE_ERROR_CODES.has(code)) return true
  if (/\bHTTP (408|425|429|5\d{2})\b/.test(message)) return true
  if (/超时|timed out|timeout/i.test(message)) return true
  if (
    /无法连接|连接被重置|解析失败|fetch failed|空响应|非 JSON 数据/.test(message)
  ) {
    return true
  }
  // The Chrome helper can be busy while a previous page is still loading.
  return /读取登录态|登录窗口启动失败/.test(message)
}

let browserQueue: Promise<unknown> = Promise.resolve()

/**
 * Krill and Aixor read the same dedicated Chrome profile through CDP. Running
 * both at the same time occasionally times out, so browser-backed reads are
 * serialized. API-key providers do not take this lock.
 */
function withBrowserLock<T>(task: () => Promise<T>): Promise<T> {
  const run = browserQueue.then(
    () => task(),
    () => task(),
  )
  browserQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function parseTomlValue(config: string, key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm')
  return pattern.exec(config)?.[1]?.trim() ?? ''
}

function readCcSwitchProviders(): CcSwitchResponse {
  if (!existsSync(DB_PATH)) {
    return {
      available: false,
      providers: [],
      error: '没有找到 ~/.cc-switch/cc-switch.db',
    }
  }

  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true })
    const rows = db
      .prepare(
        `SELECT id, app_type, name, settings_config, website_url, category,
                meta, is_current
         FROM providers
         WHERE app_type = 'codex'
         ORDER BY COALESCE(sort_index, 999), created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>

    const providers: CcSwitchProvider[] = []
    for (const row of rows) {
      const category = String(row.category ?? '')
      if (category === 'official') continue

      let settings: {
        auth?: { OPENAI_API_KEY?: unknown }
        config?: unknown
      }
      try {
        settings = JSON.parse(String(row.settings_config ?? '{}'))
      } catch {
        continue
      }

      const apiKey =
        typeof settings.auth?.OPENAI_API_KEY === 'string'
          ? settings.auth.OPENAI_API_KEY.trim()
          : ''
      const config =
        typeof settings.config === 'string' ? settings.config : ''
      const baseUrl = parseTomlValue(config, 'base_url')
      if (!apiKey || !baseUrl) continue

      let apiFormat = ''
      try {
        const meta = JSON.parse(String(row.meta ?? '{}')) as {
          apiFormat?: string
        }
        apiFormat = meta.apiFormat ?? ''
      } catch {
        // meta is optional
      }

      providers.push({
        sourceId: String(row.id ?? ''),
        name: String(row.name ?? '未命名供应商'),
        appType: String(row.app_type ?? 'codex'),
        baseUrl,
        apiKey,
        model: parseTomlValue(config, 'model'),
        apiFormat,
        isCurrent: Boolean(row.is_current),
        websiteUrl: String(row.website_url ?? ''),
      })
    }

    return { available: true, providers }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '无法读取 CC Switch 数据库'
    return { available: false, providers: [], error: message }
  } finally {
    db?.close()
  }
}

function normalizeBaseUrl(value: string) {
  const base = value.trim()
  if (!base) return ''
  try {
    const url = new URL(base)
    return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return base.replace(/\/+$/, '').toLowerCase()
  }
}

interface TomlTable {
  [key: string]: string
}

/**
 * Codex config.toml only needs a tiny subset of TOML: root scalars,
 * `[model_providers.*]` and `[profiles.*]` tables. Arrays and inline tables
 * are skipped, and credentials are never forwarded to the browser.
 */
function parseTomlTables(text: string) {
  const root: TomlTable = {}
  const tables: Record<string, TomlTable> = {}
  let current = root

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      const name = header[1].replace(/["']/g, '').trim()
      const table: TomlTable = {}
      tables[name] = table
      current = table
      continue
    }

    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line)
    if (!assignment) continue
    const key = assignment[1]
    const rawValue = assignment[2].trim()
    if (rawValue.startsWith('[') || rawValue.startsWith('{')) continue

    let value = rawValue
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]
      const end = value.lastIndexOf(quote)
      value = end > 0 ? value.slice(1, end) : value.slice(1)
    } else {
      value = value.split('#')[0].trim()
    }
    current[key] = value
  }

  return { root, tables }
}

function readCodexCurrent(): CodexCurrentSnapshot {
  const unavailable = (error: string): CodexCurrentSnapshot => ({
    available: false,
    providerId: '',
    name: '',
    baseUrl: '',
    model: '',
    profile: '',
    sourceId: null,
    official: false,
    error,
  })

  if (!existsSync(CODEX_CONFIG_PATH)) {
    return unavailable('没有找到 ~/.codex/config.toml')
  }

  let text: string
  try {
    text = readFileSync(CODEX_CONFIG_PATH, 'utf8')
  } catch {
    return unavailable('无法读取 ~/.codex/config.toml')
  }

  const { root, tables } = parseTomlTables(text)
  const profile = (root.profile ?? '').trim()
  const profileTable = profile ? tables[`profiles.${profile}`] : undefined
  const providerId =
    (profileTable?.model_provider ?? root.model_provider ?? 'openai').trim() ||
    'openai'
  const model = (profileTable?.model ?? root.model ?? '').trim()
  const modelTable = tables[`model_providers.${providerId}`]
  const baseUrl = (modelTable?.base_url ?? '').trim()
  const official = providerId === 'openai' && !baseUrl
  const name = (modelTable?.name ?? (official ? 'OpenAI 官方' : providerId)).trim()

  let sourceId: string | null = null
  if (baseUrl) {
    const ccSwitch = readCcSwitchProviders()
    if (ccSwitch.available) {
      const target = normalizeBaseUrl(baseUrl)
      const match = ccSwitch.providers.find(
        (provider) => normalizeBaseUrl(provider.baseUrl) === target,
      )
      sourceId = match?.sourceId ?? null
    }
  }

  return {
    available: true,
    providerId,
    name,
    baseUrl,
    model,
    profile,
    sourceId,
    official,
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

function readJsonBody(request: IncomingMessage, limit = 8_192) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求内容过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size === 0) {
        reject(new Error('请求内容为空'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求内容不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

function providerOrigin(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 格式不正确')
  return base.endsWith('/v1') ? base.slice(0, -3) : base
}

async function requestJson(
  url: string,
  apiKey?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `AI-Hub/${APP_VERSION} (local quota reader)`,
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`供应商接口返回 HTTP ${response.status}`)
    }
    const text = await response.text()
    if (!text) throw new Error('供应商接口返回空响应')
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('供应商接口返回了非 JSON 数据')
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('供应商接口请求超时', { cause: error })
    }
    const code = errorCauseCode(error)
    if (code) {
      const reason =
        code === 'ENOTFOUND'
          ? '供应商域名解析失败，请检查网络或代理'
          : code === 'EAI_AGAIN'
            ? 'DNS 解析超时，请检查网络或代理'
            : code === 'ECONNREFUSED'
              ? '供应商接口拒绝连接'
              : code === 'ECONNRESET'
                ? '供应商接口连接被重置'
                : /TIMEOUT|ETIMEDOUT/.test(code)
                  ? '供应商接口请求超时'
                  : '无法连接供应商接口'
      throw new Error(`${reason}（${code}）`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function finiteNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function webLoginKind(provider: CcSwitchProvider): WebLoginProvider | null {
  return detectWebLoginProvider(provider.websiteUrl, provider.baseUrl)
}

function readWebAccount(kind: WebLoginProvider) {
  return kind === 'aixor'
    ? readAixorAccountFromBrowser()
    : readKrillAccountFromBrowser()
}

async function prepareWebLogin(kind: WebLoginProvider) {
  if (kind === 'aixor') {
    await prepareAixorLogin()
  } else {
    // Do not clear the Krill token: if the helper profile still has a valid
    // session, opening /app restores quota without forcing another login.
    await prepareKrillLogin(false)
  }
}

function findProvider(sourceId: string): CcSwitchProvider | null {
  const providers = readCcSwitchProviders()
  if (!providers.available) return null
  return (
    providers.providers.find((provider) => provider.sourceId === sourceId) ??
    null
  )
}

/**
 * `loginRequired` is only returned when the provider's own API answered
 * 401/403 inside the logged-in page. Anything else (helper browser down, tab
 * still loading, CDP timeout) throws, so the caller keeps the previous snapshot
 * and reports a retryable sync error instead of claiming the session expired.
 */
async function readKrillProviderUsage(provider: CcSwitchProvider) {
  const modelCount = await fetchKrillModelCount(
    provider.baseUrl,
    provider.apiKey,
  )
  const fetchedAt = new Date().toISOString()

  const result = await readKrillAccountFromBrowser()
  if (result.status === 401 || result.status === 403) {
    return {
      sourceType: 'krill' as const,
      loginRequired: true,
      loginProvider: 'krill' as const,
      account: null,
      modelCount,
      fetchedAt,
    }
  }
  return {
    sourceType: 'krill' as const,
    loginRequired: false,
    loginProvider: 'krill' as const,
    account: result.account,
    modelCount,
    fetchedAt,
  }
}

async function readAixorProviderUsage(provider: CcSwitchProvider) {
  const modelCount = await fetchKrillModelCount(
    provider.baseUrl,
    provider.apiKey,
  )
  const fetchedAt = new Date().toISOString()

  const result = await readAixorAccountFromBrowser()
  if (result.status === 401 || result.status === 403) {
    return {
      sourceType: 'aixor' as const,
      loginRequired: true,
      loginProvider: 'aixor' as const,
      account: null,
      modelCount,
      fetchedAt,
    }
  }
  return {
    sourceType: 'aixor' as const,
    loginRequired: false,
    loginProvider: 'aixor' as const,
    account: result.account,
    modelCount,
    fetchedAt,
  }
}

async function handleLoginStart(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const body = (await readJsonBody(request)) as { sourceId?: unknown }
    const sourceId =
      typeof body?.sourceId === 'string' ? body.sourceId.trim() : ''
    const provider = sourceId ? findProvider(sourceId) : null
    const kind = provider ? webLoginKind(provider) : null
    if (!provider || !kind) {
      sendJson(response, 404, {
        status: 'error',
        message: '该供应商没有可用的网页登录额度接口',
      })
      return
    }

    await prepareWebLogin(kind)
    try {
      const result = await readWebAccount(kind)
      if (result.status >= 200 && result.status < 300) {
        sendJson(response, 200, { status: 'authenticated' })
        return
      }
    } catch (error) {
      // The window was just opened, so the page may still be loading. This is
      // "pending", not an error and definitely not an expired session.
      if (!(error instanceof WebHelperUnavailableError)) throw error
    }
    sendJson(response, 200, { status: 'pending' })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '无法打开 Krill 登录窗口'
    sendJson(response, 502, { status: 'error', message })
  }
}

async function handleLoginStatus(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url ?? '', 'http://127.0.0.1')
    const sourceId = url.searchParams.get('sourceId') ?? ''
    const provider = sourceId ? findProvider(sourceId) : null
    const kind = provider ? webLoginKind(provider) : null
    if (!provider || !kind) {
      sendJson(response, 404, {
        status: 'error',
        message: '该供应商没有可用的网页登录额度接口',
      })
      return
    }

    if (!(await isKrillHelperRunning())) {
      sendJson(response, 200, {
        status: 'error',
        message: '登录窗口已关闭，请重新点击登录',
      })
      return
    }

    try {
      const result = await readWebAccount(kind)
      if (result.status >= 200 && result.status < 300) {
        sendJson(response, 200, { status: 'authenticated' })
        return
      }
    } catch (error) {
      // Keep polling while the login page loads; only real errors abort.
      if (!(error instanceof WebHelperUnavailableError)) throw error
    }

    sendJson(response, 200, { status: 'pending' })
  } catch (error) {
    sendJson(response, 200, {
      status: 'error',
      message:
        error instanceof Error ? error.message : '等待 Krill 登录时发生错误',
    })
  }
}

async function readProviderUsage(
  provider: CcSwitchProvider,
): Promise<TokenQuotaPayload> {
  const origin = providerOrigin(provider.baseUrl)
  const base = provider.baseUrl.trim().replace(/\/+$/, '')

  const [statusResult, usageResult, modelsResult] = await Promise.allSettled([
    requestJson(`${origin}/api/status`, undefined, 8_000),
    requestJson(`${origin}/api/usage/token/`, provider.apiKey),
    requestJson(`${base}/models`, provider.apiKey, 8_000),
  ])

  if (usageResult.status === 'rejected') {
    const reason =
      usageResult.reason instanceof Error
        ? usageResult.reason.message
        : '无法读取令牌额度'
    if (/HTTP 40[45]/.test(reason)) {
      throw new Error('该供应商没有开放额度查询接口')
    }
    throw new Error(reason)
  }

  const usageRaw = usageResult.value
  const usageData =
    usageRaw && typeof usageRaw.data === 'object' && usageRaw.data
      ? (usageRaw.data as Record<string, unknown>)
      : null
  if (!usageData) throw new Error('供应商没有返回 token 用量数据')

  const statusData =
    statusResult.status === 'fulfilled' &&
    statusResult.value &&
    typeof statusResult.value.data === 'object' &&
    statusResult.value.data
      ? (statusResult.value.data as Record<string, unknown>)
      : null
  const quotaPerUnit = finiteNumber(statusData?.quota_per_unit)
  const displayType =
    typeof statusData?.quota_display_type === 'string'
      ? statusData.quota_display_type
      : 'USD'

  let modelCount = 0
  if (modelsResult.status === 'fulfilled') {
    const models = modelsResult.value?.data
    if (Array.isArray(models)) modelCount = models.length
  }

  const rawUserQuota =
    usageData.user_quota && typeof usageData.user_quota === 'object'
      ? (usageData.user_quota as Record<string, unknown>)
      : null

  return {
    quotaPerUnit: quotaPerUnit && quotaPerUnit > 0 ? quotaPerUnit : 500_000,
    displayType,
    token: {
      quotaLimit: finiteNumber(usageData.quota_limit),
      quotaPeriodStart: finiteNumber(usageData.quota_period_start),
      quotaResetPeriod:
        typeof usageData.quota_reset_period === 'string'
          ? usageData.quota_reset_period
          : null,
      totalAvailable: finiteNumber(usageData.total_available),
      totalGranted: finiteNumber(usageData.total_granted),
      totalUsed: finiteNumber(usageData.total_used),
      unlimitedQuota: Boolean(usageData.unlimited_quota),
      userQuota: rawUserQuota
        ? {
            totalAvailable: finiteNumber(rawUserQuota.total_available),
            totalUsed: finiteNumber(rawUserQuota.total_used),
          }
        : null,
    },
    modelCount,
    source: 'token-usage',
    fetchedAt: new Date().toISOString(),
  }
}

async function handleUsage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const startedAt = Date.now()
  let sourceId = ''
  let providerName: string | undefined
  let attempts = 0

  try {
    const body = (await readJsonBody(request)) as { sourceId?: unknown }
    sourceId = typeof body?.sourceId === 'string' ? body.sourceId.trim() : ''
    if (!sourceId) {
      sendJson(response, 400, { error: '缺少 sourceId' })
      return
    }

    const providers = readCcSwitchProviders()
    if (!providers.available) {
      sendJson(response, 503, {
        error: providers.error || 'CC Switch 配置不可用',
      })
      return
    }
    const provider = providers.providers.find(
      (item) => item.sourceId === sourceId,
    )
    if (!provider) {
      logSyncEvent({
        level: 'error',
        layer: 'server',
        phase: 'usage',
        sourceId,
        durationMs: Date.now() - startedAt,
        message: 'CC Switch 中找不到该供应商',
      })
      sendJson(response, 404, { error: 'CC Switch 中找不到该供应商' })
      return
    }
    providerName = provider.name

    const kind = webLoginKind(provider)
    // Browser-backed reads share one Chrome profile; only retry once so the
    // other provider waiting on the lock is not blocked for too long.
    const maxAttempts = kind ? 2 : SYNC_ATTEMPTS

    const readOnce = async () => {
      attempts += 1
      if (kind === 'krill') return readKrillProviderUsage(provider)
      if (kind === 'aixor') return readAixorProviderUsage(provider)
      return readProviderUsage(provider)
    }

    const readWithRetry = async () => {
      for (;;) {
        try {
          return await readOnce()
        } catch (error) {
          const { message, code } = describeSyncError(error)
          const timedOut =
            /超时|timed out|timeout/i.test(message) ||
            code === 'ETIMEDOUT' ||
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            code === 'UND_ERR_HEADERS_TIMEOUT'
          // A 12s timeout is expensive to repeat; give it one retry while
          // connection-refused / 5xx errors still get the full budget.
          const attemptLimit = timedOut
            ? Math.min(maxAttempts, 2)
            : maxAttempts
          if (attempts >= attemptLimit || !isRetryableSyncError(error)) {
            throw error
          }
          const wait = RETRY_DELAYS_MS[attempts - 1] ?? 1_500
          logSyncEvent({
            level: 'warn',
            layer: 'server',
            phase: 'usage',
            provider: provider.name,
            sourceId,
            attempt: attempts,
            durationMs: Date.now() - startedAt,
            message: `${message}，${wait}ms 后重试`,
            code: code || undefined,
          })
          await delay(wait)
        }
      }
    }

    const payload = kind
      ? await withBrowserLock(readWithRetry)
      : await readWithRetry()

    const loginRequired = Boolean(
      payload &&
        typeof payload === 'object' &&
        (payload as { loginRequired?: unknown }).loginRequired === true,
    )
    // Remember what we actually read so every client (and every device) can
    // fall back to the same snapshot when a later read fails.
    saveUsageSnapshot(sourceId, payload)
    logSyncEvent({
      level: loginRequired ? 'warn' : 'info',
      layer: 'server',
      phase: 'usage',
      provider: provider.name,
      sourceId,
      attempt: attempts,
      durationMs: Date.now() - startedAt,
      message: loginRequired ? '需要登录才能读取账户额度' : '同步成功',
    })
    sendJson(response, 200, payload)
  } catch (error) {
    const { message, code } = describeSyncError(error)
    logSyncEvent({
      level: 'error',
      layer: 'server',
      phase: 'usage',
      provider: providerName,
      sourceId,
      attempt: attempts || undefined,
      durationMs: Date.now() - startedAt,
      message: message || '无法读取供应商额度',
      code: code || undefined,
    })
    const cached = getUsageSnapshot(sourceId)
    sendJson(response, 502, {
      error: message || '无法读取供应商额度',
      code: code || undefined,
      retryable: isRetryableSyncError(error),
      // The last snapshot this machine managed to read. Clients apply it and
      // only show the sync error, instead of keeping a stale「需要登录」state.
      cached: cached?.payload ?? null,
      cachedAt: cached?.cachedAt ?? null,
    })
  }
}

async function handleClientLog(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const body = (await readJsonBody(request, 4_096)) as Record<string, unknown>
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.trim().slice(0, max) || undefined : undefined
    const level =
      body.level === 'warn'
        ? 'warn'
        : body.level === 'error'
          ? 'error'
          : 'info'
    logSyncEvent({
      level,
      layer: 'client',
      phase: text(body.phase, 40) ?? 'client',
      provider: text(body.provider, 120),
      sourceId: text(body.sourceId, 120),
      attempt:
        typeof body.attempt === 'number' && Number.isFinite(body.attempt)
          ? Math.max(1, Math.floor(body.attempt))
          : undefined,
      durationMs:
        typeof body.durationMs === 'number' && Number.isFinite(body.durationMs)
          ? Math.max(0, Math.round(body.durationMs))
          : undefined,
      message: text(body.message, 500) ?? '客户端同步失败',
      code: text(body.code, 60),
    })
    sendJson(response, 200, { ok: true })
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : '无法写入同步日志',
    })
  }
}

function ccSwitchMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) {
  const url = request.url ?? ''
  const path = url.split('?')[0]
  const knownPaths = [
    PROVIDERS_PATH,
    USAGE_PATH,
    CODEX_CURRENT_PATH,
    LOGIN_START_PATH,
    LOGIN_STATUS_PATH,
    LOGS_PATH,
    CLIENT_LOG_PATH,
  ]
  if (!knownPaths.includes(path)) {
    next()
    return
  }

  if (!isLoopback(request)) {
    sendJson(response, 403, {
      error: 'AI Hub 本地接口只允许本机访问',
    })
    return
  }

  if (path === LOGS_PATH) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    const parsed = new URL(url, 'http://127.0.0.1')
    const requested = Number(parsed.searchParams.get('limit') ?? '100')
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 100
    const result = readSyncEvents(limit)
    sendJson(response, 200, {
      path: result.path || SYNC_LOG_DIR,
      events: result.events,
    })
    return
  }

  if (path === CLIENT_LOG_PATH) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    void handleClientLog(request, response)
    return
  }

  if (path === CODEX_CURRENT_PATH) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    sendJson(response, 200, readCodexCurrent())
    return
  }

  if (path === PROVIDERS_PATH) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { error: 'Method not allowed' })
      return
    }
    sendJson(response, 200, readCcSwitchProviders())
    return
  }

  if (path === LOGIN_STATUS_PATH) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      sendJson(response, 405, { status: 'error', message: 'Method not allowed' })
      return
    }
    void handleLoginStatus(request, response)
    return
  }

  if (path === LOGIN_START_PATH) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      sendJson(response, 405, { status: 'error', message: 'Method not allowed' })
      return
    }
    void handleLoginStart(request, response)
    return
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }
  void handleUsage(request, response)
}

export function ccSwitchPlugin(): Plugin {
  return {
    name: 'ai-hub:cc-switch',
    configureServer(server) {
      server.middlewares.use(ccSwitchMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(ccSwitchMiddleware)
    },
  }
}
