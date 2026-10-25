import type { Provider } from './types'
import { PROVIDER_COLORS } from './utils'

export interface CcSwitchProviderConfig {
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
  providers: CcSwitchProviderConfig[]
  error?: string
}

const VENDOR_LABELS: Record<string, string> = {
  'Packy Company': 'PackyAPI',
  aixor: 'Aixor',
}

const SOURCE_COLORS: Record<string, string> = {
  'Packy Company': '#4D6BFE',
  aixor: '#E8875A',
}

export async function fetchCcSwitchProviders(): Promise<
  CcSwitchProviderConfig[]
> {
  let response: Response
  try {
    response = await fetch('/api/cc-switch/providers', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    throw new Error('无法连接本机 CC Switch 配置接口')
  }

  if (!response.ok) {
    // 服务端会给出可执行的说明（例如「只允许本机访问」/「没有找到数据库」），
    // 原样透出比统一的「无法读取 CC Switch 配置」有用得多。
    let detail = ''
    try {
      const payload = (await response.json()) as { error?: unknown }
      if (typeof payload?.error === 'string') detail = payload.error.trim()
    } catch {
      // 静态部署时这里拿到的可能是 index.html，忽略即可。
    }
    if (detail) throw new Error(detail)
    throw new Error(
      response.status === 404
        ? 'CC Switch 导入需要本地开发服务（npm run dev）'
        : '无法读取 CC Switch 配置',
    )
  }

  let data: CcSwitchResponse
  try {
    data = (await response.json()) as CcSwitchResponse
  } catch {
    throw new Error('CC Switch 配置接口返回了非 JSON 数据')
  }

  if (!data.available) {
    throw new Error(data.error || '未找到 CC Switch 数据库')
  }
  return Array.isArray(data.providers) ? data.providers : []
}

export function ccSwitchProviderToProvider(
  config: CcSwitchProviderConfig,
  existing: Provider | undefined,
  index: number,
): Provider {
  const now = new Date().toISOString()
  const loginHaystack = `${config.websiteUrl} ${config.baseUrl}`
  const loginProvider = /krill-code\.com/i.test(loginHaystack)
    ? 'krill'
    : /aixor\.org/i.test(loginHaystack)
      ? 'aixor'
      : existing?.loginProvider
  return {
    id: existing?.id ?? `cc-${config.sourceId}`,
    name: config.name,
    vendor: VENDOR_LABELS[config.name] ?? config.name,
    type: 'coding',
    color:
      existing?.color ??
      SOURCE_COLORS[config.name] ??
      PROVIDER_COLORS[index % PROVIDER_COLORS.length],
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    billing: 'quota',
    currency: 'USD',
    planName: `Codex · ${config.model || 'Custom API'}`,
    quotaTotal: existing?.quotaTotal ?? 0,
    quotaUsed: existing?.quotaUsed ?? 0,
    cycle: existing?.cycle ?? 'month',
    // 重置日与到期日由接口或用户维护，重新导入时不能抹掉手填的值。
    resetAt: existing?.resetAt ?? '',
    expiresAt: existing?.expiresAt ?? '',
    balance: existing?.balance ?? 0,
    monthlySpend: existing?.monthlySpend ?? 0,
    monthlyBudget: existing?.monthlyBudget ?? 0,
    callsToday: existing?.callsToday ?? 0,
    successRate: existing?.successRate ?? 1,
    enabled: existing?.enabled ?? true,
    note:
      existing?.note ||
      `从 CC Switch 导入的 ${config.appType} 配置，额度通过供应商 token / 账户接口自动同步。`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    syncMode: 'openai-billing',
    unlimited: existing?.unlimited ?? false,
    limitUnknown: existing?.limitUnknown ?? false,
    keyUnlimited: existing?.keyUnlimited ?? false,
    lifetimeUsed: existing?.lifetimeUsed ?? 0,
    accountBalance: existing?.accountBalance,
    loginProvider,
    loginRequired: existing?.loginRequired ?? Boolean(loginProvider),
    lastSyncedAt: existing?.lastSyncedAt ?? '',
    // 导入只刷新配置，不负责修复同步故障，保留原有的失败原因。
    syncError: existing?.syncError ?? '',
    source: 'cc-switch',
    sourceId: config.sourceId,
    modelCount: existing?.modelCount,
  }
}
