import { useEffect, useState } from 'react'

/**
 * 页面自己是「服务器」还是「客户端」。
 *
 * 浏览器拿不到这个信息，只能问服务端：它看连接的来源地址，回环就是本机，其他
 * 就是别的设备。纯静态部署时接口不存在，返回 null。
 *
 * 这个判断只影响两件事：
 * - CC Switch 导入、网页登录需要读本机配置 / 拉起本机窗口，客户端做不了；
 * - 提示文案要说清额度是哪台机器读到的（同步本身由服务端代劳，客户端也能点）。
 */
export type RuntimeRole = 'server' | 'client'

export interface RuntimeInfo {
  role: RuntimeRole
  hostname: string
  platform: string
  addresses: string[]
  mode: 'dev' | 'preview'
  serverTime: string
}

let pending: Promise<RuntimeInfo | null> | null = null

function isRuntimeInfo(value: unknown): value is RuntimeInfo {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.role === 'server' || record.role === 'client') &&
    typeof record.hostname === 'string'
  )
}

async function loadRuntimeInfo(): Promise<RuntimeInfo | null> {
  try {
    const response = await fetch('/api/runtime', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    if (!isRuntimeInfo(payload)) return null
    return {
      ...payload,
      addresses: Array.isArray(payload.addresses) ? payload.addresses : [],
    }
  } catch {
    return null
  }
}

/** 同一次会话只问一次；服务地址变了会整页重载，不需要缓存失效逻辑。 */
export function fetchRuntimeInfo(): Promise<RuntimeInfo | null> {
  if (!pending) pending = loadRuntimeInfo()
  return pending
}

export function useRuntimeInfo(): {
  runtime: RuntimeInfo | null
  checked: boolean
} {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchRuntimeInfo().then((info) => {
      if (!alive) return
      setRuntime(info)
      setChecked(true)
    })
    return () => {
      alive = false
    }
  }, [])

  return { runtime, checked }
}

/**
 * 同步实际在哪台机器上执行，返回可直接接「执行 / 同步」的短语。
 * 本机 → 「在本机」；客户端 → 「在服务器 xxx 上」。
 */
export function syncRunnerPhrase(runtime: RuntimeInfo | null) {
  if (!runtime || runtime.role === 'server') return '在本机'
  return `在服务器 ${runtime.hostname} 上`
}

/**
 * CC Switch 导入、网页登录这类「必须碰到本机」的动作是否可用。
 * 额度同步不在此列：它由服务端代劳，客户端也能触发。
 */
export function canUseLocalTools(
  runtime: RuntimeInfo | null,
  checked: boolean,
) {
  if (!checked) return false
  return runtime?.role === 'server'
}
