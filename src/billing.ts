import type { Currency, Cycle, Provider } from './types'
import { fetchPixellabBalance, type PixellabBalance } from './pixellab'
import { withRetry } from './net'

/**
 * Quota data comes from the provider's New API compatible endpoints:
 *   GET  /api/usage/token/   (token quota; may include account user_quota)
 *   GET  /api/status          (quota_per_unit, display type)
 *   GET  /v1/models           (available models)
 *
 * PixelLab uses its own account endpoint (`/v2/balance`, see pixellab.ts).
 *
 * A token being marked `unlimited_quota` only means the API key itself is not
 * capped. The account can still have a plan or balance; if the provider does
 * not expose account quota to this key, the UI must say "unknown" rather than
 * pretending the account is unlimited.
 */
export interface BillingSnapshot {
  quotaTotal: number
  quotaUsed: number
  limitUnknown: boolean
  /** 供应商把 API Key 标记为 unlimited_quota；是否真的不限额由 apply 时判定 */
  keyUnlimited: boolean
  lifetimeUsed: number
  accountBalance?: number
  /** 供应商返回的套餐名，同步时一并展示 */
  planName?: string
  /** 额度单位，缺省为美元 */
  quotaUnit?: 'usd' | 'generation'
  /** 额度计价币种，来自上游 quota_display_type */
  currency?: Currency
  modelCount: number
  resetAt: string
  cycle: Cycle
  syncedAt: string
  loginRequired: boolean
  loginProvider?: 'krill' | 'aixor'
}

interface NewApiUsagePayload {
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
  source: string
  fetchedAt: string
}

interface WebAccountUsagePayload {
  sourceType: 'krill' | 'aixor'
  loginRequired: boolean
  loginProvider: 'krill' | 'aixor'
  account: {
    creditBalanceUsd: number | null
    lifetimeUsedUsd?: number | null
    planNames: string[]
    quotaTotalUsd: number | null
    quotaUsedUsd: number | null
    quotaRemainingUsd: number | null
    resetAt: string
    subscriptionEndAt: string
    cycle: 'week' | 'month'
  } | null
  modelCount: number
  fetchedAt: string
}

type ProviderUsagePayload = NewApiUsagePayload | WebAccountUsagePayload

export function readableSyncError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message.replace(/\s+/g, ' ').trim()
      : ''
  if (!raw) return '同步失败，请检查网络或密钥'
  if (/无法连接本地 CC Switch/.test(raw)) {
    return '本地同步服务不可用，请确认 npm run dev 仍在运行'
  }
  if (/[\u4e00-\u9fff]/.test(raw)) {
    // The local bridge already returns an actionable Chinese message
    // (including the upstream error code), so do not flatten it.
    return raw.slice(0, 160)
  }
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(raw)) {
    return '网络连接失败，请检查网络或代理'
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(raw)) {
    return '无法连接供应商接口，请检查网络或代理'
  }
  // 中文消息在上面已经原样返回（保留上游错误码），这里只兜住英文超时。
  if (/timed out|timeout/i.test(raw)) {
    return '接口响应超时，请稍后重试'
  }
  return raw.slice(0, 160)
}

const SYNC_REQUEST_ATTEMPTS = 3
const SYNC_RETRY_DELAYS_MS = [400, 1_200]
const SYNC_REQUEST_TIMEOUT_MS = 20_000

/**
 * Carries the last snapshot the local bridge managed to read. When a sync fails
 * (helper Chrome asleep, CDP timeout, network blip) the UI can still show the
 * account's real quota instead of keeping a stale「需要登录」badge.
 */
export class UsageRequestError extends Error {
  readonly retryable: boolean
  readonly cachedPayload?: ProviderUsagePayload
  readonly cachedAt?: string

  constructor(
    message: string,
    retryable = false,
    cachedPayload?: ProviderUsagePayload,
    cachedAt?: string,
  ) {
    super(message)
    this.name = 'UsageRequestError'
    this.retryable = retryable
    this.cachedPayload = cachedPayload
    this.cachedAt = cachedAt
  }
}

function isUsagePayload(value: unknown): value is ProviderUsagePayload {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.sourceType === 'krill' || record.sourceType === 'aixor') {
    return true
  }
  return Boolean(record.token && typeof record.token === 'object')
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function toCycle(period: string | null): Cycle {
  if (period === 'daily') return 'day'
  if (period === 'weekly') return 'week'
  return 'month'
}

/** 按周期推进一个月，月末（1/31）不溢出到下下个月。 */
function addMonth(date: Date) {
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + 1)
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate()
  date.setDate(Math.min(day, lastDay))
}

function nextReset(periodStart: number, period: string | null) {
  if (!Number.isFinite(periodStart) || periodStart <= 0) return ''
  const date = new Date(periodStart * 1000)
  if (Number.isNaN(date.getTime())) return ''
  if (period === 'weekly') {
    date.setDate(date.getDate() + 7)
  } else if (period === 'daily') {
    date.setDate(date.getDate() + 1)
  } else {
    addMonth(date)
  }
  return date.toISOString()
}

async function fetchUsagePayloadOnce(
  sourceId: string,
): Promise<ProviderUsagePayload> {
  let response: Response
  try {
    response = await fetch('/api/cc-switch/usage', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sourceId }),
      cache: 'no-store',
      // 桥接进程卡住时不要挂到浏览器 TCP 超时。
      signal: AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new UsageRequestError(
      '无法连接本地 CC Switch 查询服务，请确认 npm run dev 仍在运行',
      true,
    )
  }

  let payload: unknown = null
  const text = await response.text()
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new UsageRequestError('本地额度查询返回了非 JSON 数据', true)
  }

  if (!response.ok) {
    const record =
      payload && typeof payload === 'object'
        ? (payload as {
            error?: unknown
            cached?: unknown
            cachedAt?: unknown
          })
        : {}
    const message =
      typeof record.error === 'string'
        ? record.error
        : `额度查询失败（HTTP ${response.status}）`
    // Upstream 5xx/timeouts are already retried inside the local bridge.
    // Retrying the whole request here would multiply the wait, so only retry
    // local availability errors (dev server restarting / temporarily busy).
    const retryable =
      response.status === 429 ||
      response.status === 503 ||
      response.status === 504
    throw new UsageRequestError(
      message,
      retryable,
      isUsagePayload(record.cached) ? record.cached : undefined,
      typeof record.cachedAt === 'string' ? record.cachedAt : undefined,
    )
  }

  if (!payload || typeof payload !== 'object') {
    throw new UsageRequestError('本地额度查询返回为空', true)
  }
  // 成功响应也要验形状：早先只判断了 object，token 缺失时会在解析层抛
  // 「Cannot read properties of undefined」，直接漏给用户看。
  if (!isUsagePayload(payload)) {
    throw new UsageRequestError(
      '本地额度查询返回的数据结构无法识别，请更新本地服务后重试',
      false,
    )
  }

  return payload
}

/**
 * The local bridge is a dev server: it restarts on config changes and can be
 * briefly unreachable right after wake-from-sleep. Retry those connection
 * failures instead of painting every provider as "同步失败".
 */
async function fetchUsagePayload(
  sourceId: string,
): Promise<ProviderUsagePayload> {
  return withRetry(() => fetchUsagePayloadOnce(sourceId), {
    attempts: SYNC_REQUEST_ATTEMPTS,
    delays: SYNC_RETRY_DELAYS_MS,
    retryable: (error) => error instanceof UsageRequestError && error.retryable,
  })
}

function isWebAccountPayload(
  payload: ProviderUsagePayload,
): payload is WebAccountUsagePayload {
  const sourceType = (payload as { sourceType?: unknown }).sourceType
  return sourceType === 'krill' || sourceType === 'aixor'
}

function parseWebAccountSnapshot(
  provider: Provider,
  payload: WebAccountUsagePayload,
): BillingSnapshot {
  const syncedAt = payload.fetchedAt || new Date().toISOString()
  const modelCount = Number.isFinite(payload.modelCount)
    ? payload.modelCount
    : 0

  if (payload.loginRequired) {
    return {
      quotaTotal: 0,
      quotaUsed: provider.lifetimeUsed ?? provider.quotaUsed ?? 0,
      limitUnknown: false,
      keyUnlimited: false,
      lifetimeUsed: provider.lifetimeUsed ?? 0,
      modelCount,
      resetAt: '',
      cycle: 'month',
      syncedAt,
      loginRequired: true,
      loginProvider: payload.loginProvider,
    }
  }

  const account = payload.account
  if (!account) {
    return {
      quotaTotal: 0,
      quotaUsed: provider.lifetimeUsed ?? 0,
      limitUnknown: true,
      keyUnlimited: false,
      lifetimeUsed: provider.lifetimeUsed ?? 0,
      modelCount,
      resetAt: '',
      cycle: 'month',
      syncedAt,
      loginRequired: false,
      loginProvider: payload.loginProvider,
    }
  }

  if (
    account.quotaTotalUsd !== null &&
    account.quotaTotalUsd > 0
  ) {
    const total = account.quotaTotalUsd
    const remaining =
      account.quotaRemainingUsd !== null
        ? Math.max(account.quotaRemainingUsd, 0)
        : null
    const used =
      account.quotaUsedUsd !== null
        ? Math.max(account.quotaUsedUsd, 0)
        : remaining !== null
          ? Math.max(total - remaining, 0)
          : 0
    const lifetime =
      account.lifetimeUsedUsd !== null &&
      account.lifetimeUsedUsd !== undefined
        ? Math.max(account.lifetimeUsedUsd, 0)
        : used
    return {
      quotaTotal: roundMoney(total),
      quotaUsed: roundMoney(used),
      limitUnknown: false,
      keyUnlimited: false,
      lifetimeUsed: roundMoney(lifetime),
      accountBalance:
        account.creditBalanceUsd !== null
          ? roundMoney(account.creditBalanceUsd)
          : undefined,
      modelCount,
      resetAt: account.resetAt,
      cycle: account.cycle,
      syncedAt,
      loginRequired: false,
      loginProvider: payload.loginProvider,
    }
  }

  if (account.creditBalanceUsd !== null) {
    const lifetime =
      account.lifetimeUsedUsd !== null &&
      account.lifetimeUsedUsd !== undefined
        ? Math.max(account.lifetimeUsedUsd, 0)
        : 0
    return {
      quotaTotal: 0,
      quotaUsed: 0,
      limitUnknown: false,
      keyUnlimited: false,
      lifetimeUsed: roundMoney(lifetime),
      accountBalance: roundMoney(account.creditBalanceUsd),
      modelCount,
      resetAt: '',
      cycle: 'month',
      syncedAt,
      loginRequired: false,
      loginProvider: payload.loginProvider,
    }
  }

  return {
    quotaTotal: 0,
    quotaUsed: 0,
    limitUnknown: true,
    keyUnlimited: false,
    lifetimeUsed: 0,
    modelCount,
    resetAt: '',
    cycle: 'month',
    syncedAt,
    loginRequired: false,
    loginProvider: payload.loginProvider,
  }
}

function parsePixellabSnapshot(
  provider: Provider,
  balance: PixellabBalance,
): BillingSnapshot {
  const base = {
    limitUnknown: false,
    keyUnlimited: false,
    accountBalance: balance.creditsUsd,
    modelCount: provider.modelCount ?? 0,
    resetAt: '',
    cycle: 'month' as Cycle,
    syncedAt: balance.syncedAt,
    loginRequired: false,
    planName: balance.planName ?? 'PixelLab 订阅',
  }

  const total = balance.generationsTotal
  const left = balance.generationsLeft

  // No active subscription (free account): only the credits balance is known.
  if (total === undefined || total <= 0) {
    return {
      ...base,
      quotaTotal: 0,
      quotaUsed: 0,
      lifetimeUsed: 0,
      quotaUnit: 'usd',
    }
  }

  return {
    ...base,
    quotaTotal: roundMoney(total),
    quotaUsed: roundMoney(Math.max(total - (left ?? total), 0)),
    // Only the current cycle is known; never feed generation counts into the
    // USD aggregates (累计用量 / 构成图).
    lifetimeUsed: 0,
    quotaUnit: 'generation',
  }
}

export async function fetchProviderBilling(
  provider: Provider,
): Promise<BillingSnapshot> {
  if (provider.syncMode === 'pixellab') {
    const balance = await fetchPixellabBalance(provider.apiKey)
    return parsePixellabSnapshot(provider, balance)
  }

  if (!provider.sourceId) {
    throw new Error('该供应商没有关联 CC Switch，无法查询接口额度')
  }

  const payload = await fetchUsagePayload(provider.sourceId)
  return parseUsagePayload(provider, payload)
}

/** Parses both live and cached payloads so every client shows the same data. */
export function parseUsagePayload(
  provider: Provider,
  payload: ProviderUsagePayload,
): BillingSnapshot {
  if (isWebAccountPayload(payload)) {
    return parseWebAccountSnapshot(provider, payload)
  }
  const newApiPayload = payload as NewApiUsagePayload
  const token = newApiPayload.token
  const perUnit =
    Number.isFinite(newApiPayload.quotaPerUnit) &&
    newApiPayload.quotaPerUnit > 0
      ? newApiPayload.quotaPerUnit
      : 500_000

  const toAmount = (units: number | null | undefined) => {
    const num = Number(units)
    return Number.isFinite(num) ? num / perUnit : 0
  }

  const tokenUsed = toAmount(token.totalUsed)
  // 上游 quota_display_type 决定计价币种；只认明确的 CNY，其余按美元处理。
  const currency: Currency =
    String(newApiPayload.displayType ?? '').toUpperCase() === 'CNY'
      ? 'CNY'
      : 'USD'
  const syncedAt = newApiPayload.fetchedAt || new Date().toISOString()
  const modelCount = Number.isFinite(newApiPayload.modelCount)
    ? newApiPayload.modelCount
    : 0

  // A period-based plan (Packy's custom token quota, or New API plan quotas).
  if (
    token.quotaLimit !== null &&
    token.quotaLimit > 0 &&
    token.quotaPeriodStart !== null &&
    token.totalAvailable !== null
  ) {
    const total = toAmount(token.quotaLimit)
    const available = Math.max(toAmount(token.totalAvailable), 0)
    return {
      quotaTotal: roundMoney(total),
      quotaUsed: roundMoney(Math.max(total - available, 0)),
      currency,
      limitUnknown: false,
      keyUnlimited: token.unlimitedQuota,
      lifetimeUsed: roundMoney(tokenUsed),
      modelCount,
      resetAt: nextReset(token.quotaPeriodStart, token.quotaResetPeriod),
      cycle: toCycle(token.quotaResetPeriod),
      syncedAt,
      loginRequired: false,
    }
  }

  // Account-level balance is available only when the key allows user-quota
  // queries. This is optional on New API tokens.
  if (
    token.userQuota &&
    token.userQuota.totalAvailable !== null
  ) {
    const balance = toAmount(token.userQuota.totalAvailable)
    const used = toAmount(
      token.userQuota.totalUsed ?? token.totalUsed,
    )
    return {
      quotaTotal: 0,
      quotaUsed: roundMoney(used),
      currency,
      limitUnknown: false,
      keyUnlimited: token.unlimitedQuota,
      lifetimeUsed: roundMoney(used),
      accountBalance: roundMoney(balance),
      modelCount,
      resetAt: '',
      cycle: 'month',
      syncedAt,
      loginRequired: false,
    }
  }

  // The key has no period quota and the account quota was not returned. Keep
  // the real accumulated usage, but explicitly mark the account limit unknown.
  return {
    quotaTotal: 0,
    quotaUsed: roundMoney(tokenUsed),
    currency,
    limitUnknown: true,
    keyUnlimited: token.unlimitedQuota,
    lifetimeUsed: roundMoney(tokenUsed),
    modelCount,
    resetAt: '',
    cycle: 'month',
    syncedAt,
    loginRequired: false,
  }
}

export function applyBillingSnapshot(
  provider: Provider,
  snapshot: BillingSnapshot,
): Provider {
  if (snapshot.loginRequired) {
    return {
      ...provider,
      loginProvider: snapshot.loginProvider ?? provider.loginProvider,
      loginRequired: true,
      modelCount: snapshot.modelCount || provider.modelCount,
      lastSyncedAt: snapshot.syncedAt,
      syncError: '',
      updatedAt: snapshot.syncedAt,
    }
  }

  // unlimited_quota 只说明 Key 本身不限额；只有连账户周期额度和余额都没有时，
  // 才能对外宣称「不限额度」，否则仍按真实额度展示。
  const unlimited =
    snapshot.keyUnlimited &&
    snapshot.quotaTotal <= 0 &&
    snapshot.accountBalance === undefined

  return {
    ...provider,
    billing: 'quota',
    currency: snapshot.currency ?? provider.currency,
    quotaTotal: snapshot.quotaTotal,
    quotaUsed: snapshot.quotaUsed,
    unlimited,
    limitUnknown: snapshot.limitUnknown,
    keyUnlimited: snapshot.keyUnlimited,
    lifetimeUsed: snapshot.lifetimeUsed,
    accountBalance: snapshot.accountBalance,
    planName: snapshot.planName ?? provider.planName,
    quotaUnit: snapshot.quotaUnit,
    modelCount: snapshot.modelCount || provider.modelCount,
    resetAt: snapshot.resetAt,
    cycle: snapshot.cycle,
    loginRequired: false,
    loginProvider: snapshot.loginProvider ?? provider.loginProvider,
    lastSyncedAt: snapshot.syncedAt,
    syncError: '',
    updatedAt: snapshot.syncedAt,
  }
}

/**
 * Turns a failed sync into a provider update that keeps the numbers the bridge
 * last read successfully and only adds the error message. Without this, a
 * failing read left whatever `loginRequired` flag the browser happened to have
 * cached, which is why「需要登录」stuck around on other devices.
 */
export function applySyncFailure(provider: Provider, error: unknown): Provider {
  const message = readableSyncError(error)
  let base = provider

  if (error instanceof UsageRequestError && error.cachedPayload) {
    const snapshot = parseUsagePayload(provider, error.cachedPayload)
    const cachedAt = new Date(
      error.cachedAt ?? snapshot.syncedAt,
    ).getTime()
    const current = provider.lastSyncedAt
      ? new Date(provider.lastSyncedAt).getTime()
      : Number.NaN
    if (Number.isNaN(current) || Number.isNaN(cachedAt) || cachedAt >= current) {
      base = applyBillingSnapshot(provider, snapshot)
    }
  }

  return { ...base, syncError: message, updatedAt: new Date().toISOString() }
}
