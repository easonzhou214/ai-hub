import type { Cycle, Provider } from './types'
import { fetchPixellabBalance, type PixellabBalance } from './pixellab'

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
  unlimited: boolean
  limitUnknown: boolean
  keyUnlimited: boolean
  lifetimeUsed: number
  accountBalance?: number
  /** 供应商返回的套餐名，同步时一并展示 */
  planName?: string
  /** 额度单位，缺省为美元 */
  quotaUnit?: 'usd' | 'generation'
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
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, ' ').slice(0, 160)
  }
  return '同步失败，请检查网络或密钥'
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function toCycle(period: string | null): Cycle {
  if (period === 'weekly') return 'week'
  return 'month'
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
    date.setMonth(date.getMonth() + 1)
  }
  return date.toISOString()
}

async function fetchUsagePayload(
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
    })
  } catch {
    throw new Error('无法连接本地 CC Switch 查询服务')
  }

  let payload: unknown = null
  const text = await response.text()
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('本地额度查询返回了非 JSON 数据')
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `额度查询失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  return payload as ProviderUsagePayload
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
      unlimited: false,
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
      unlimited: false,
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
      unlimited: false,
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
      unlimited: false,
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
    unlimited: false,
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

export function parsePixellabSnapshot(
  provider: Provider,
  balance: PixellabBalance,
): BillingSnapshot {
  const base = {
    unlimited: false,
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
      unlimited: false,
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
      unlimited: false,
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
    unlimited: false,
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

  return {
    ...provider,
    billing: 'quota',
    currency: 'USD',
    quotaTotal: snapshot.quotaTotal,
    quotaUsed: snapshot.quotaUsed,
    unlimited: snapshot.unlimited,
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

export function isSyncedProvider(provider: Provider) {
  return provider.syncMode === 'openai-billing'
}

export function isUnlimitedProvider(provider: Provider) {
  return Boolean(provider.unlimited)
}
