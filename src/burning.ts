import type { Provider } from './types'
import { isInterfaceSynced } from './utils'

/**
 * 「这个供应商正在被使用」的判定。
 *
 * 远端部署时页面读不到本机 `~/.codex/config.toml`（那张表在运行服务的
 * 机器上，而不是在你的电脑上），所以不能再用 Codex 的配置去点亮火焰。
 * 改成看两次同步之间的额度差：累计已用变大，或者账户余额变小，就说明
 * 这段时间里这个账号在烧。
 *
 * 两点约束让它不至于乱亮：
 * - 只认接口同步的供应商。手动 / 演示数据每次同步都会随机增长，不是信号。
 * - 最后一次观测到增长后只保持 HOLD_MS；两次观测间隔太久的（比如昨天关的
 *   页面今天才打开）只更新基线，不追溯点亮。
 */

const STORAGE_KEY = 'aihub.burning.v2'
/** 最后一次看到增长后，火焰保持多久（同步间隔是 5 分钟）。 */
const HOLD_MS = 15 * 60_000
/** 超过这个间隔的两次观测不构成「连续观察」，只更新基线。 */
const MAX_GAP_MS = 3 * 60 * 60_000
/** 供应商后台按分/厘结算，浮点噪声不算增长。 */
const EPSILON = 1e-6

interface UsageMark {
  /** 上次看到的累计已用（越大越费） */
  used: number | null
  /** 上次看到的账户余额（越小越费） */
  balance: number | null
  /** 最后一次观测到增长的时间戳，0 表示还没见过增长 */
  hitAt: number
  /** 这条基线是什么时候记下的 */
  at: number
}

type MarkMap = Record<string, UsageMark>

function readMarks(): MarkMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as MarkMap
  } catch {
    return {}
  }
}

function writeMarks(marks: MarkMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marks))
  } catch {
    // 隐私模式下写不进去，本次会话仍然按内存里的判断走。
  }
}

/**
 * 用来判断「有没有在烧」的累计值。优先累计已用（单调递增，不受周期
 * 重置影响），没有就退回周期已用。
 */
function cumulativeUsed(provider: Provider): number | null {
  if (typeof provider.lifetimeUsed === 'number' && provider.lifetimeUsed > 0) {
    return provider.lifetimeUsed
  }
  if (typeof provider.quotaUsed === 'number' && provider.quotaUsed > 0) {
    return provider.quotaUsed
  }
  return null
}

/** 两次快照之间这个账号有没有被消耗。 */
export function usageIncreased(previous: Provider, next: Provider): boolean {
  const prevUsed = cumulativeUsed(previous)
  const nextUsed = cumulativeUsed(next)
  if (prevUsed !== null && nextUsed !== null && nextUsed > prevUsed + EPSILON) {
    return true
  }
  return (
    typeof previous.accountBalance === 'number' &&
    typeof next.accountBalance === 'number' &&
    next.accountBalance < previous.accountBalance - EPSILON
  )
}

/** 这条额度快照是不是最近的观测（太旧就不能用来判断「此刻还在烧」）。 */
export function isFreshSnapshot(
  provider: Provider,
  now: number = Date.now(),
): boolean {
  const seenAt = Date.parse(provider.lastSyncedAt ?? provider.updatedAt ?? '')
  return Number.isFinite(seenAt) && now - seenAt <= MAX_GAP_MS
}

/**
 * 直接把一批供应商标记为「刚观测到在烧」。
 *
 * 给 `runSync` 用：新设备第一次打开时还没有基线，靠这次同步前后的内存对比
 * 就能立刻点亮，不必干等下一轮。
 */
export function markBurning(providerIds: string[], now: number = Date.now()) {
  if (providerIds.length === 0) return
  const marks = readMarks()
  for (const id of providerIds) {
    const prev = marks[id]
    marks[id] = {
      used: prev?.used ?? null,
      balance: prev?.balance ?? null,
      hitAt: now,
      at: now,
    }
  }
  writeMarks(marks)
}

/**
 * 返回正在消耗额度的供应商 id。会顺带把这次的额度快照写进 localStorage，
 * 下次同步再比一次；所以它不是纯函数，放在 effect 里调用。
 */
export function detectBurning(
  providers: Provider[],
  now: number = Date.now(),
): string[] {
  const previous = readMarks()
  const marks: MarkMap = {}
  const burning: string[] = []

  for (const provider of providers) {
    if (!provider.enabled || !isInterfaceSynced(provider)) continue

    const used = cumulativeUsed(provider)
    const balance =
      typeof provider.accountBalance === 'number' ? provider.accountBalance : null
    const prev = previous[provider.id]

    let hitAt = prev?.hitAt ?? 0
    if (prev) {
      const withinReach = now - prev.at > 0 && now - prev.at <= MAX_GAP_MS
      const usedGrew =
        used !== null && prev.used !== null && used > prev.used + EPSILON
      const balanceDrained =
        balance !== null &&
        prev.balance !== null &&
        balance < prev.balance - EPSILON
      if (withinReach && (usedGrew || balanceDrained)) hitAt = now
    }

    marks[provider.id] = {
      used: used ?? prev?.used ?? null,
      balance: balance ?? prev?.balance ?? null,
      hitAt,
      at: now,
    }

    if (hitAt > 0 && now - hitAt < HOLD_MS) burning.push(provider.id)
  }

  // 只保留当前列表里的供应商，删掉的那些自动从基线里消失。
  writeMarks(marks)
  return burning
}
