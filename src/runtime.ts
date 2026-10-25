import { useEffect, useState } from 'react'

/**
 * 页面自己是「服务器」还是「客户端」。
 *
 * 浏览器拿不到这个信息，只能问服务端：它看连接的来源地址，回环就是本机，其他
 * 就是别的设备。纯静态部署时接口不存在，返回 null。
 *
 * 为什么要区分：`/api/cc-switch/*` 默认只接受回环请求，客户端点同步一定 403。
 * 提前知道就能把按钮置灰并说明原因，而不是让用户等一轮超时再看到红字。
 */
export type RuntimeRole = 'server' | 'client'

export interface RuntimeInfo {
  role: RuntimeRole
  hostname: string
  platform: string
  addresses: string[]
  mode: 'dev' | 'preview'
  syncFromClient: boolean
  serverTime: string
}

let pending: Promise<RuntimeInfo | null> | null = null

function isRuntimeInfo(value: unknown): value is RuntimeInfo {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.role === 'server' || record.role === 'client') &&
    typeof record.hostname === 'string' &&
    typeof record.syncFromClient === 'boolean'
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

/** CC Switch 相关动作（同步/导入/网页登录）在这台设备上是否可用。 */
export function bridgeReachable(runtime: RuntimeInfo | null) {
  if (!runtime) return false
  return runtime.role === 'server' || runtime.syncFromClient
}
