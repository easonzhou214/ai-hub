import type {
  AlertItem,
  Currency,
  Cycle,
  Provider,
  ProviderStatus,
  ProviderType,
  QuotaState,
} from './types'

export const FX_USD_CNY = 7.2

/**
 * 生成 id。
 *
 * `crypto.randomUUID()` 只在安全上下文（https / localhost）里有定义：局域网用
 * `http://192.168.x.x` 打开时它是 undefined，直接调会抛
 * 「crypto.randomUUID is not a function」，客户端新增供应商就卡在保存这一步。
 * `crypto.getRandomValues()` 没有这个限制，用它手搓一个 v4 兜底。
 */
export function createId() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // 少数环境会禁用它，继续走下面的兜底。
    }
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 全仓共用的额度阈值。放在一处，避免「状态判定」「告警文案」「进度条配色」
 * 各自维护一份数字后又慢慢漂移。
 */
/** 已用 ≥80% 视为额度紧张，≥100% 视为耗尽（状态与告警共用）。 */
export const QUOTA_WARN_PERCENT = 80
export const QUOTA_EXHAUSTED_PERCENT = 100
/** 进度条独立的分档：≥90% 才换成危险色，避免 80% 附近就满屏红。 */
export const BAR_DANGER_PERCENT = 90
/** 账户余额低于该值视为偏低（按供应商自身币种计）。 */
export const LOW_BALANCE_AMOUNT = 1
/** 到期前 5 天进入「即将到期」。 */
export const EXPIRING_SOON_DAYS = 5

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

/**
 * 看板的进度条统一表达「还剩多少」：把已用百分比翻转成剩余百分比。
 * 颜色仍按已用比例判断（见 usageTone），避免剩余越少反而越绿。
 */
export function remainingPercent(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null
  return clamp(100 - percent, 0, 100)
}

export function toUSD(amount: number, currency: Currency) {
  return currency === 'CNY' ? amount / FX_USD_CNY : amount
}

/** 统一的千分位数字格式，金额与次数共用同一套 toLocaleString 配置。 */
function groupNumber(value: number, decimals: number) {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatMoney(
  amount: number,
  currency: Currency,
  options: { decimals?: number } = {},
) {
  return `${CURRENCY_SYMBOL[currency]}${groupNumber(amount, options.decimals ?? 2)}`
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
  return `${groupNumber(amount, options.decimals ?? 0)} 次`
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

export function formatFullDate(
  isoDate: string | null | undefined,
  separator = '-',
) {
  if (!isoDate) return '—'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '—'
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}${separator}${m}${separator}${d}`
}

/** 头像里显示的首字母：优先显示名称，其次用户名。 */
export function initialOf(
  displayName: string | null | undefined,
  username = '',
  fallback = '?',
) {
  return (
    (displayName ?? '').trim().charAt(0).toUpperCase() ||
    username.trim().charAt(0).toUpperCase() ||
    fallback
  )
}

export function relativeTime(isoDate: string | null | undefined) {
  if (!isoDate) return '尚未同步'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '尚未同步'
  const diff = Date.now() - date.getTime()
  // 轻微的未来时间（时钟偏差）按「刚刚」处理；明显在未来的直接显示日期，
  // 否则远端设备写错时间会一直显示「刚刚」。
  if (diff < -60_000) return formatFullDate(isoDate)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatFullDate(isoDate)
}

export function cycleLabel(cycle: Cycle) {
  if (cycle === 'day') return '每天'
  if (cycle === 'week') return '每周'
  return '每月'
}

/**
 * 周期额度的标题。Krill 这类套餐的额度按周下发（本周 $325.50），
 * 统一叫「周期额度」会让人误以为整份套餐（月额度 $1302）归这个周期管。
 */
export function periodQuotaLabel(provider: Pick<Provider, 'cycle'>) {
  if (provider.cycle === 'week') return '本周额度'
  if (provider.cycle === 'day') return '今日额度'
  return '周期额度'
}

export function periodUsedLabel(provider: Pick<Provider, 'cycle'>) {
  if (provider.cycle === 'week') return '本周已用'
  if (provider.cycle === 'day') return '今日已用'
  return '本周期已用'
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

function quotaLabel(provider: Provider) {
  if (provider.syncMode === 'openai-billing' && provider.resetAt) {
    return periodQuotaLabel(provider)
  }
  if (provider.syncMode === 'openai-billing') return '账户额度'
  return '周期额度'
}

export function getQuotaState(provider: Provider): QuotaState {
  const total = Number.isFinite(provider.quotaTotal)
    ? Math.max(provider.quotaTotal, 0)
    : 0
  const used = Number.isFinite(provider.quotaUsed)
    ? Math.max(provider.quotaUsed, 0)
    : 0

  // 不限额优先：没有总量，也没有百分比可言。
  if (provider.unlimited) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? used,
      total: null,
      available: 0,
      label: '不限额度',
    }
  }

  // 周期额度优先于钱包余额；两者同时存在时钱包在界面上单独一行展示。
  if (provider.billing === 'quota' && total > 0 && !provider.limitUnknown) {
    const clamped = Math.min(used, total)
    return {
      percent: (clamped / total) * 100,
      used: clamped,
      total,
      available: Math.max(total - clamped, 0),
      label: quotaLabel(provider),
    }
  }

  if (provider.accountBalance !== undefined) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? used,
      total: null,
      available: Math.max(provider.accountBalance, 0),
      label: '账户余额',
    }
  }

  if (provider.limitUnknown) {
    return {
      percent: null,
      used: provider.lifetimeUsed ?? used,
      total: null,
      available: 0,
      label: '累计用量',
    }
  }

  // 声明了周期额度但总量未知：返回 total=null，避免界面显示「已用 0 / 0」。
  if (provider.billing === 'quota') {
    return {
      percent: null,
      used,
      total: null,
      available: 0,
      label: quotaLabel(provider),
    }
  }

  if (provider.monthlyBudget > 0) {
    const spend = Math.max(provider.monthlySpend, 0)
    return {
      percent: (spend / provider.monthlyBudget) * 100,
      used: spend,
      total: provider.monthlyBudget,
      // 预算模式的「剩余」是预算减去已花，不是钱包余额。
      available: Math.max(provider.monthlyBudget - spend, 0),
      label: '本月预算',
    }
  }

  return {
    percent: null,
    used: provider.monthlySpend,
    total: null,
    available: Math.max(provider.balance, 0),
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
  if (expires !== null && expires <= EXPIRING_SOON_DAYS) return 'expiring'
  if (provider.loginRequired) return 'login'
  if (provider.syncError) return 'error'
  if (provider.unlimited) return 'healthy'
  if (provider.limitUnknown) return 'unknown'

  const quota = getQuotaState(provider)
  if (quota.percent !== null) {
    if (quota.available <= 0 || quota.percent >= QUOTA_EXHAUSTED_PERCENT) {
      return 'exhausted'
    }
    return quota.percent >= QUOTA_WARN_PERCENT ? 'warning' : 'healthy'
  }

  if (provider.accountBalance !== undefined) {
    if (provider.accountBalance <= 0) return 'exhausted'
    return provider.accountBalance < LOW_BALANCE_AMOUNT ? 'warning' : 'healthy'
  }

  // 充值型账户的余额是唯一口径，0 必须算耗尽（与 accountBalance 保持一致）。
  if (provider.billing === 'balance') {
    if (provider.balance <= 0) return 'exhausted'
    return provider.balance < LOW_BALANCE_AMOUNT ? 'warning' : 'healthy'
  }

  return 'healthy'
}

export const STATUS_META: Record<
  ProviderStatus,
  { label: string; hint: string }
> = {
  healthy: { label: '正常', hint: '额度充足，状态良好' },
  warning: { label: '额度紧张', hint: '使用率较高或账户余额偏低' },
  exhausted: {
    label: '额度耗尽',
    hint: '周期额度或账户余额已用完，请等待重置或续费',
  },
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
  if (expires !== null && expires <= EXPIRING_SOON_DAYS) {
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
  } else if (provider.limitUnknown && !provider.unlimited) {
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
    provider.accountBalance < LOW_BALANCE_AMOUNT &&
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
  if (quota.percent !== null && quota.percent >= QUOTA_WARN_PERCENT) {
    const exhausted = quota.available <= 0
    alerts.push({
      id: `${provider.id}-quota`,
      providerId: provider.id,
      tone: 'warn',
      title: exhausted
        ? `${provider.name} 额度已耗尽`
        : `${provider.name} 额度已用 ${Math.min(99, Math.round(quota.percent))}%`,
      description: exhausted
        ? provider.billing === 'quota'
          ? `${periodQuotaLabel(provider)} ${formatQuota(quota.total ?? 0, provider)} 已全部用完，请等待重置或续费，或切换到其他供应商。`
          : '本月预算已全部用完，请调整预算或切换到其他供应商。'
        : provider.billing === 'quota'
          ? `仅剩 ${formatQuota(quota.available, provider)} ${
              provider.resetAt ? periodQuotaLabel(provider) : '账户额度'
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
