import type { Provider, ProviderStatus, QuotaState } from './types'
import {
  expiryLabel,
  formatMoney,
  getQuotaState,
  getStatus,
  isInterfaceSynced,
  loginBrand,
  relativeTime,
  remainingPercent,
} from './utils'

/**
 * 供应商的「展示派生状态」。
 *
 * 概览卡片、供应商列表、额度明细原来各自算了一遍同样的 8 个布尔值，结果已经
 * 漂移（其中一处漏了 unlimited 分支）。所有渲染器统一消费这里的结果，新增
 * 一种状态时只需要改这一处。
 */
export interface ProviderView {
  quota: QuotaState
  remaining: number | null
  status: ProviderStatus
  expiry: string | null
  synced: boolean
  needsLogin: boolean
  loginLabel: string
  /** 账户无额度上限（供应商把 Key 与账户都标为不限额） */
  unlimited: boolean
  /** 账户额度未通过接口返回 */
  unknown: boolean
  hasPlanQuota: boolean
  hasWallet: boolean
  hasAccountBalance: boolean
  hasBoth: boolean
  planBased: boolean
  /** 同步失败且没有任何可用数字 */
  noData: boolean
  cumulative: number
  lastSync: string
  money: (value: number) => string
}

export function describeProvider(provider: Provider): ProviderView {
  const quota = getQuotaState(provider)
  const synced = isInterfaceSynced(provider)
  const hasPlanQuota = quota.percent !== null && quota.total !== null
  const hasWallet = provider.accountBalance !== undefined

  return {
    quota,
    remaining: remainingPercent(quota.percent),
    status: getStatus(provider),
    expiry: expiryLabel(provider),
    synced,
    needsLogin: Boolean(provider.loginRequired && provider.loginProvider),
    loginLabel: loginBrand(provider),
    unlimited: Boolean(provider.unlimited),
    unknown: Boolean(provider.limitUnknown),
    hasPlanQuota,
    hasWallet,
    hasAccountBalance: hasWallet && !hasPlanQuota,
    hasBoth: hasPlanQuota && hasWallet,
    planBased: Boolean(
      synced &&
        quota.percent !== null &&
        (provider.resetAt || provider.syncMode === 'pixellab'),
    ),
    // 只有「确实没有任何数字」才算读取失败；累计用量为 0 是有效值。
    noData: Boolean(
      provider.syncError &&
        provider.quotaTotal <= 0 &&
        provider.accountBalance === undefined &&
        provider.lifetimeUsed === undefined,
    ),
    cumulative: provider.lifetimeUsed ?? quota.used,
    lastSync: provider.lastSyncedAt ? relativeTime(provider.lastSyncedAt) : '',
    money: (value: number) => formatMoney(value, provider.currency),
  }
}
