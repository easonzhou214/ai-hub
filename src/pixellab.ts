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

import { withRetry } from './net'

const BALANCE_URL = 'https://api.pixellab.ai/v2/balance'
const BALANCE_TIMEOUT_MS = 15_000
const BALANCE_ATTEMPTS = 3
const BALANCE_RETRY_DELAYS_MS = [500, 1_500]

class PixellabRequestError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'PixellabRequestError'
    this.retryable = retryable
  }
}

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

async function fetchBalanceOnce(token: string): Promise<PixellabBalance> {
  let response: Response
  try {
    response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new PixellabRequestError('PixelLab 接口响应超时，请稍后重试', true)
    }
    throw new PixellabRequestError('无法连接 PixelLab 接口，请检查网络', true)
  }

  if (response.status === 401) {
    throw new PixellabRequestError('PixelLab API Token 无效或已失效')
  }
  if (response.status === 429) {
    throw new PixellabRequestError(
      'PixelLab 请求过于频繁，请稍后重试',
      true,
    )
  }

  let text: string
  try {
    text = await response.text()
  } catch {
    throw new PixellabRequestError('PixelLab 响应读取失败，请重试', true)
  }

  let payload: BalancePayload | null = null
  try {
    payload = text ? (JSON.parse(text) as BalancePayload) : null
  } catch {
    throw new PixellabRequestError(
      'PixelLab 额度查询返回了非 JSON 数据',
      true,
    )
  }

  if (!response.ok) {
    throw new PixellabRequestError(
      `PixelLab 额度查询失败（HTTP ${response.status}）`,
      response.status >= 500,
    )
  }
  if (!payload) {
    throw new PixellabRequestError('PixelLab 额度查询返回为空', true)
  }

  // Number(null) === 0、Number('') === 0，会把「字段缺失」误判成「零额度」，
  // 进而被判定为额度耗尽。这里只接受真正的数字或数字字符串。
  const finite = (value: unknown) => {
    if (value === null || value === undefined || value === '') return undefined
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

export async function fetchPixellabBalance(
  apiKey: string,
): Promise<PixellabBalance> {
  const token = apiKey.trim()
  if (!token) {
    throw new Error('请先填写 PixelLab API Token')
  }

  return withRetry(() => fetchBalanceOnce(token), {
    attempts: BALANCE_ATTEMPTS,
    delays: BALANCE_RETRY_DELAYS_MS,
    retryable: (error) =>
      error instanceof PixellabRequestError && error.retryable,
    // 不要为一个卡住的连接连续等 3 × 15 秒。
    maxAttemptsFor: (error) =>
      error instanceof PixellabRequestError && /超时/.test(error.message)
        ? 2
        : BALANCE_ATTEMPTS,
  })
}
