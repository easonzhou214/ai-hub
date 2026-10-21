/**
 * PixelLab (pixellab.ai) is a pixel-art generation API. Its API token can read
 * the account balance directly:
 *
 *   GET https://api.pixellab.ai/v2/balance
 *   Authorization: Bearer <API token>
 *
 *   {
 *     "credits": { "type": "usd", "usd": 0 },
 *     "subscription": {
 *       "type": "generations",
 *       "status": "active",
 *       "plan": "Tier 1: Pixel Apprentice",
 *       "generations": 767.3,   // remaining this cycle, not used
 *       "total": 2000
 *     }
 *   }
 *
 * Notes:
 * - `generations` is what is *left*, so used = total - generations.
 * - The endpoint does not expose a reset date; the plan simply renews monthly.
 * - The API answers CORS preflights for arbitrary origins, so the browser can
 *   call it directly with the token the user stored locally. No proxy needed.
 * - `/v1/balance` also works but only returns `{ type, usd }` for credits, so
 *   the subscription quota has to come from `/v2/balance`.
 */

const BALANCE_URL = 'https://api.pixellab.ai/v2/balance'

interface BalancePayload {
  credits?: { type?: string; usd?: number | null } | null
  subscription?: {
    type?: string
    status?: string
    plan?: string
    generations?: number | null
    total?: number | null
  } | null
}

export interface PixellabBalance {
  syncedAt: string
  /** 账户 credits（美元），订阅耗尽后才会扣这里 */
  creditsUsd?: number
  planName?: string
  planStatus?: string
  /** 本周期剩余次数 */
  generationsLeft?: number
  /** 本周期总额度（次数） */
  generationsTotal?: number
}

export async function fetchPixellabBalance(
  apiKey: string,
): Promise<PixellabBalance> {
  const token = apiKey.trim()
  if (!token) {
    throw new Error('请先填写 PixelLab API Token')
  }

  let response: Response
  try {
    response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })
  } catch {
    throw new Error('无法连接 PixelLab 接口，请检查网络')
  }

  if (response.status === 401) {
    throw new Error('PixelLab API Token 无效或已失效')
  }

  const text = await response.text()
  let payload: BalancePayload | null = null
  try {
    payload = text ? (JSON.parse(text) as BalancePayload) : null
  } catch {
    throw new Error('PixelLab 额度查询返回了非 JSON 数据')
  }

  if (!response.ok) {
    throw new Error(`PixelLab 额度查询失败（HTTP ${response.status}）`)
  }
  if (!payload) {
    throw new Error('PixelLab 额度查询返回为空')
  }

  const finite = (value: unknown) => {
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
  }

  const credits = finite(payload.credits?.usd)
  const subscription = payload.subscription ?? undefined
  const total = finite(subscription?.total)
  const left = finite(subscription?.generations)

  return {
    syncedAt: new Date().toISOString(),
    creditsUsd:
      credits === undefined ? undefined : Math.max(credits, 0),
    planName: subscription?.plan?.trim() || undefined,
    planStatus: subscription?.status?.trim() || undefined,
    generationsTotal:
      total === undefined ? undefined : Math.max(total, 0),
    generationsLeft: left === undefined ? undefined : Math.max(left, 0),
  }
}
