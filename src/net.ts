/**
 * 网络请求的公共小工具。
 *
 * 额度同步有两条链路（CC Switch 中转 / PixelLab 直连），原本各自复制了
 * `sleep` + `networkAvailable` + 重试循环三份实现。抽到这里，重试预算与
 * 「离线就不重试」的判断只需要维护一处。
 */

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 浏览器报告离线时不做无意义的等待重试（Node 侧没有 navigator，视为在线）。 */
export function networkAvailable() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export interface RetryOptions {
  /** 总尝试次数（含首次）。 */
  attempts: number
  /** 每次失败后的等待时间，下标从 0 开始；不足时沿用最后一项。 */
  delays: readonly number[]
  /** 返回 true 表示这个错误值得重试。 */
  retryable: (error: unknown) => boolean
  /** 每次重试前的回调，便于写日志。 */
  onRetry?: (error: unknown, attempt: number, wait: number) => void
  /** 允许为单次场景覆盖剩余次数（例如超时重试代价高）。 */
  maxAttemptsFor?: (error: unknown) => number
}

export function retryDelay(delays: readonly number[], attempt: number) {
  return delays[Math.min(attempt - 1, delays.length - 1)] ?? 0
}

/** 依次尝试，直到成功、不可重试或次数用完；抛出最后一次错误。 */
export async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const limit = options.maxAttemptsFor?.(error) ?? options.attempts
      if (
        !options.retryable(error) ||
        attempt >= Math.min(limit, options.attempts) ||
        !networkAvailable()
      ) {
        break
      }
      const wait = retryDelay(options.delays, attempt)
      options.onRetry?.(error, attempt, wait)
      await sleep(wait)
    }
  }
  throw lastError
}
