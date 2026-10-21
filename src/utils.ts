import type {
  AlertItem,
  Currency,
  Provider,
  ProviderStatus,
  ProviderType,
  QuotaState,
} from './types'

export const FX_USD_CNY = 7.2

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: '$',
  CNY: '¥',
}

export const TYPE_LABEL: Record<ProviderType, string> = {
  coding: '编程',
  image: '绘图',
}

export const TYPE_DESCRIPTION: Record<ProviderType, string> = {
  coding: 'Claude / Codex / 通义灵码等',
  image: 'Midjourney / 即梦 / Flux 等',
}

export const PROVIDER_COLORS = [
  '#C15F3C',
  '#0F9D74',
  '#4D6BFE',
  '#6D5AE6',
  '#E879A9',
  '#E8875A',
  '#1F2937',
  '#0EA5A5',
]

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function toUSD(amount: number, currency: Currency) {
  return currency === 'CNY' ? amount / FX_USD_CNY : amount
}

export function formatMoney(
  amount: number,
  currency: Currency,
  options: { decimals?: number } = {},
) {
  const decimals = options.decimals ?? 2
  const safe = Number.isFinite(amount) ? amount : 0
  return `${CURRENCY_SYMBOL[currency]}${safe.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function formatNumber(value: number) {
  return (Number.isFinite(value) ? value : 0).toLocaleString('en-US')
}

/** PixelLab 等按次计费的订阅，额度单位是「生成次数」而不是金额。 */
export function isGenerationQuota(provider: Pick<Provider, 'quotaUnit'>) {
  return provider.quotaUnit === 'generation'
}

/** 有接口自动同步的供应商（CC Switch / PixelLab）。 */
export function isInterfaceSynced(
  provider: Pick<Provider, 'syncMode'>,
) {
  return (
    provider.syncMode === 'openai-billing' ||
    provider.syncMode === 'pixellab'
  )
}

/**
 * 按供应商的计量单位格式化额度：美元（默认）或生成次数。
 * 次数不参与美元汇总，所以不要在总计里混用。
 */
export function formatQuota(
  amount: number,
  provider: Pick<Provider, 'quotaUnit' | 'currency'>,
  options: { decimals?: number } = {},
) {
  if (!isGenerationQuota(provider)) {
    return formatMoney(amount, provider.currency, options)
  }
  // 次数按整数展示：接口会返回小数点，但看板只需要量级。
  const safe = Number.isFinite(amount) ? amount : 0
  const decimals = options.decimals ?? 0
  return `${safe.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} 次`
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value > 0 && value < 1) return '<1%'
  return `${Math.round(value)}%`
}

/** 以「今天 0 点」为基准计算剩余天数，未来为正值。 */
export function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function formatMonthDay(isoDate: string | null | undefined) {
  if (!isoDate) return '—'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function formatFullDate(isoDate: string | null | undefined) {
  if (!isoDate) return '—'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '—'
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function relativeTime(isoDate: string | null | undefined) {
  if (!isoDate) return '尚未同步'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '尚未同步'
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatFullDate(isoDate)
}

export function resetLabel(provider: Provider) {
  if (provider.billing === 'balance') return '充值型 · 无周期重置'
  // PixelLab 的余额接口只给剩余次数，不返回重置日期。
  if (!provider.resetAt && provider.syncMode === 'pixellab') return '按月重置'
  const days = daysUntil(provider.resetAt)
  if (days === null) return '未设置重置日期'
  if (days <= 0) return '即将重置'
  if (days === 1) return '明天重置'
  return `${days} 天后重置`
}

export function expiryLabel(provider: Provider) {
  const days = daysUntil(provider.expiresAt)
  if (days === null) return null
  if (days < 0) return `已过期 ${Math.abs(days)} 天`
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  return `${days} 天后到期`
}

export function getQuotaState(provider: Provider): QuotaState {
  // A periodic plan takes precedence when both a plan and a wallet balance
  // exist. The wallet is still shown as a separate line in the UI.
  if (
    !provider.limitUnknown &&
    !provider.unlimited &&
    provider.billing === 'quota' &&
    provider.quotaTotal > 0
  ) {
    const total = Math.max(provider.quotaTotal, 0)
    const used = clamp(provider.quotaUsed, 0, total)
    const percent = total > 0 ? (used / total) * 100 : null
    return {
      percent,
      used,
      total,
      available: Math.max(total - used, 0),
      label:
        provider.syncMode === 'openai-billing' && provider.resetAt
          ? '周期额度'
          : provider.syncMode === 'openai-billing'
            ? '账户额度'
            : '周期额度',
    }
  }

  if (provider.accountBalance !== undefined) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? provider.quotaUsed,
      total: null,
      available: provider.accountBalance,
      label: '账户余额',
    }
  }

  if (provider.limitUnknown) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? provider.quotaUsed,
      total: null,
      available: 0,
      label: '累计用量',
    }
  }

  if (provider.unlimited) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? provider.quotaUsed,
      total: null,
      available: 0,
      label: '累计用量',
    }
  }

  if (provider.billing === 'quota') {
    const total = Math.max(provider.quotaTotal, 0)
    const used = clamp(provider.quotaUsed, 0, Math.max(total, 0))
    const percent = total > 0 ? (used / total) * 100 : null
    return {
      percent,
      used,
      total,
      available: Math.max(total - used, 0),
      label:
        provider.syncMode === 'openai-billing' && provider.resetAt
          ? '周期额度'
          : provider.syncMode === 'openai-billing'
            ? '账户额度'
            : '周期额度',
    }
  }

  if (provider.monthlyBudget > 0) {
    const percent = (provider.monthlySpend / provider.monthlyBudget) * 100
    return {
      percent,
      used: provider.monthlySpend,
      total: provider.monthlyBudget,
      available: provider.balance,
      label: '本月预算',
    }
  }

  return {
    percent: null,
    used: provider.monthlySpend,
    total: null,
    available: provider.balance,
    label: '账户余额',
  }
}

export function loginBrand(provider: Provider) {
  if (provider.loginProvider === 'aixor') return 'Aixor'
  if (provider.loginProvider === 'krill') return 'Krill'
  return provider.name
}

export function getStatus(provider: Provider): ProviderStatus {
  if (!provider.enabled) return 'disabled'
  const expires = daysUntil(provider.expiresAt)
  if (expires !== null && expires < 0) return 'expired'
  if (expires !== null && expires <= 5) return 'expiring'
  if (provider.loginRequired) return 'login'
  if (provider.syncError) return 'error'
  if (provider.limitUnknown) return 'unknown'
  if (provider.billing === 'quota' && provider.quotaTotal > 0) {
    const percent = getQuotaState(provider).percent
    return percent !== null && percent >= 80 ? 'warning' : 'healthy'
  }
  if (provider.accountBalance !== undefined) {
    return provider.accountBalance < 1 ? 'warning' : 'healthy'
  }
  const percent = getQuotaState(provider).percent
  if (percent !== null && percent >= 80) return 'warning'
  return 'healthy'
}

export const STATUS_META: Record<
  ProviderStatus,
  { label: string; hint: string }
> = {
  healthy: { label: '正常', hint: '额度充足，状态良好' },
  warning: { label: '额度紧张', hint: '使用率较高或账户余额偏低' },
  unknown: {
    label: '额度待确认',
    hint: 'API Key 不限额，但账户额度没有通过接口返回',
  },
  login: {
    label: '需要登录',
    hint: '需要在供应商网页完成登录后才能读取账户额度',
  },
  error: {
    label: '额度查询失败',
    hint: '额度接口请求失败，请检查接口地址、密钥或供应商后台',
  },
  expiring: { label: '即将到期', hint: '套餐将在 5 天内到期' },
  expired: { label: '已到期', hint: '套餐已过期，请续费或更新到期日期' },
  disabled: { label: '已停用', hint: '已暂停计入用量统计' },
}

export function logoText(provider: Pick<Provider, 'vendor' | 'name'>) {
  const map: Record<string, string> = {
    Anthropic: 'AN',
    OpenAI: 'OA',
    DeepSeek: 'DS',
    Cursor: 'CU',
    Midjourney: 'MJ',
    Replicate: 'RP',
    Stability: 'SA',
    Google: 'GO',
    '火山引擎': '火',
    '即梦': '即',
    Moonshot: 'MS',
    PackyAPI: 'PC',
    Aixor: 'A',
  }
  if (map[provider.vendor]) return map[provider.vendor]
  if (map[provider.name]) return map[provider.name]
  const source = (provider.vendor || provider.name || '?').trim()
  if (/^[\x00-\x7F]+$/.test(source)) {
    return source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AI'
  }
  return source.slice(0, 1)
}

export function providerAlerts(provider: Provider): AlertItem[] {
  if (!provider.enabled) return []
  const alerts: AlertItem[] = []
  const expires = daysUntil(provider.expiresAt)
  if (expires !== null && expires <= 5) {
    alerts.push({
      id: `${provider.id}-expiry`,
      providerId: provider.id,
      tone: 'expire',
      title:
        expires < 0
          ? `${provider.name} 已过期 ${Math.abs(expires)} 天`
          : expires === 0
            ? `${provider.name} 今天到期`
            : `${provider.name} ${expires} 天后到期`,
      description:
        expires < 0
          ? '套餐已过期，请续费后更新供应商的到期日期。'
          : '套餐到期后请在供应商页面续费，并更新下次重置日期。',
    })
  }

  if (provider.syncError) {
    alerts.push({
      id: `${provider.id}-sync`,
      providerId: provider.id,
      tone: 'warn',
      title: `${provider.name} 额度同步失败`,
      description: provider.syncError,
    })
  } else if (provider.limitUnknown) {
    alerts.push({
      id: `${provider.id}-unknown`,
      providerId: provider.id,
      tone: 'warn',
      title: `${provider.name} 账户额度待确认`,
      description:
        'API Key 被供应商标记为不限额，但该 Key 没有返回账户额度；请到供应商后台查看，或使用账户访问令牌读取。',
    })
  }

  if (
    provider.accountBalance !== undefined &&
    provider.accountBalance < 1 &&
    provider.quotaTotal <= 0
  ) {
    alerts.push({
      id: `${provider.id}-balance`,
      providerId: provider.id,
      tone: 'warn',
      title:
        provider.accountBalance <= 0
          ? `${provider.name} 账户余额不足`
          : `${provider.name} 账户余额偏低`,
      description: `当前余额 ${formatMoney(provider.accountBalance, provider.currency)}，请充值或切换供应商。`,
    })
  }

  const quota = getQuotaState(provider)
  if (quota.percent !== null && quota.percent >= 80) {
    alerts.push({
      id: `${provider.id}-quota`,
      providerId: provider.id,
      tone: 'warn',
      title: `${provider.name} 额度已用 ${Math.round(quota.percent)}%`,
      description:
        provider.billing === 'quota'
          ? `仅剩 ${formatQuota(quota.available, provider)} ${
              provider.resetAt ? '周期额度' : '账户额度'
            }，建议提前补充。`
          : `本月预算仅剩 ${formatMoney(Math.max((quota.total ?? 0) - quota.used, 0), provider.currency)}，建议调整预算。`,
    })
  }
  return alerts
}

export function sumInUSD(providers: Provider[], pick: (p: Provider) => number) {
  return providers.reduce(
    (total, p) =>
      // 按次计费的额度不能折算成美元，直接排除在金额汇总之外。
      isGenerationQuota(p) ? total : total + toUSD(pick(p), p.currency),
    0,
  )
}
