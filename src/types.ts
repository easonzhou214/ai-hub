export type ProviderType = 'coding' | 'image'
export type BillingMode = 'quota' | 'balance'
export type Currency = 'USD' | 'CNY'
/**
 * manual          — values typed in by hand
 * openai-billing  — New API / CC Switch token & account endpoints
 * pixellab        — PixelLab account API (`/v2/balance`), keyed by API token
 */
export type SyncMode = 'manual' | 'openai-billing' | 'pixellab'

/** 「添加供应商」抽屉里的一键预设 */
export type ProviderPreset = 'pixellab'
export type Cycle = 'week' | 'month'
export type PageKey = 'overview' | 'providers' | 'usage'
export type ProviderStatus =
  | 'healthy'
  | 'warning'
  | 'exhausted'
  | 'unknown'
  | 'login'
  | 'error'
  | 'expiring'
  | 'expired'
  | 'disabled'

export interface Provider {
  id: string
  name: string
  vendor: string
  type: ProviderType
  color: string
  baseUrl: string
  apiKey: string
  billing: BillingMode
  currency: Currency
  planName: string
  /** 周期额度模式 */
  quotaTotal: number
  quotaUsed: number
  cycle: Cycle
  resetAt: string
  expiresAt: string
  /** 充值余额模式 */
  balance: number
  monthlySpend: number
  monthlyBudget: number
  /** 轻量使用数据 */
  callsToday: number
  successRate: number
  enabled: boolean
  note: string
  createdAt: string
  updatedAt: string
  /** 额度来源：手动维护，或通过供应商接口自动同步 */
  syncMode?: SyncMode
  unlimited?: boolean
  /** API Key 本身不限额，但账户额度未通过接口返回 */
  limitUnknown?: boolean
  /** 供应商把 API Key 标记为 unlimited_quota */
  keyUnlimited?: boolean
  /** 需要网页登录态才能读取额度的供应商 */
  loginProvider?: 'krill' | 'aixor'
  loginRequired?: boolean
  /** 账户累计用量（与周期额度区分） */
  lifetimeUsed?: number
  /** 开启用户额度查询后返回的账户余额 */
  accountBalance?: number
  /**
   * 额度计量单位。缺省按美元处理；PixelLab 的订阅额度按「生成次数」计量，
   * 这类账户不参与美元汇总，避免把次数当成金额相加。
   */
  quotaUnit?: 'usd' | 'generation'
  lastSyncedAt?: string
  syncError?: string
  source?: 'cc-switch'
  sourceId?: string
  modelCount?: number
}

export interface QuotaState {
  percent: number | null
  used: number
  total: number | null
  /** 剩余额度 / 可用余额 */
  available: number
  label: string
}

export interface ProviderDraft
  extends Omit<Provider, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string
  createdAt?: string
  updatedAt?: string
}

export interface AlertItem {
  id: string
  providerId: string
  tone: 'warn' | 'expire'
  title: string
  description: string
}
