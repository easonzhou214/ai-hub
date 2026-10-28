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
export type Cycle = 'day' | 'week' | 'month'
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

/**
 * 订阅型供应商常有两层额度：真正卡住请求的短窗口（如 Krill 的周窗口），
 * 以及这一份套餐买到的总额度（如 30 天的月额度）。`quotaTotal/quotaUsed`
 * 始终表示**短窗口**那层，套餐总额放在这里只做展示，不参与百分比计算。
 */
export interface QuotaBucket {
  total: number
  used: number
  remaining: number
}

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
  /** 周期额度模式：短窗口（daily_limit / quota_per_period）的额度 */
  quotaTotal: number
  quotaUsed: number
  cycle: Cycle
  resetAt: string
  /** 套餐总额（例如 Krill 月额度 $1302），与上面的短窗口额度区分开 */
  monthQuota?: QuotaBucket
  /** 网页订阅信息，仅用于展示 */
  subscriptionPlan?: string
  subscriptionId?: string
  subscriptionStartAt?: string
  /** 供应商返回的可用端点，例如「直连」「cdn」 */
  entryRoutes?: string[]
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
