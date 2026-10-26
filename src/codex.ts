import type { Provider } from './types'

/** Safe subset of ~/.codex/config.toml, read by the local Vite bridge. */
export interface CodexCurrentSnapshot {
  available: boolean
  providerId: string
  name: string
  baseUrl: string
  model: string
  profile: string
  sourceId: string | null
  /** 正在使用的 key 尾号，用于区分共用同一 base_url 的多个账号。 */
  keySuffix?: string | null
  official: boolean
  error?: string
}

export async function fetchCodexCurrent(): Promise<CodexCurrentSnapshot | null> {
  try {
    const response = await fetch('/api/codex/current', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = (await response.json()) as CodexCurrentSnapshot
    return data && typeof data === 'object' ? data : null
  } catch {
    // The local bridge is optional; static deployments simply omit the marker.
    return null
  }
}

export function normalizeBaseUrl(value: string | undefined) {
  const base = value?.trim() ?? ''
  if (!base) return ''
  try {
    const url = new URL(base)
    const host = url.host.replace(/^www\./i, '')
    return `${host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return base.replace(/\/+$/, '').toLowerCase()
  }
}

/**
 * Resolve the Codex config to one of the providers shown in AI Hub.
 * The CC Switch source id is most reliable, then the API key suffix (several
 * accounts can share one base URL), and the base URL only as a last resort.
 */
export function findCodexProvider(
  providers: Provider[],
  current: CodexCurrentSnapshot | null,
): Provider | undefined {
  if (!current || !current.available) return undefined
  const coding = providers.filter((provider) => provider.type === 'coding')

  if (current.sourceId) {
    const bySource = coding.find(
      (provider) => provider.sourceId === current.sourceId,
    )
    if (bySource) return bySource
  }

  const suffix = current.keySuffix?.trim()
  if (suffix) {
    const byKey = coding.find((provider) =>
      (provider.apiKey ?? '').trim().endsWith(suffix),
    )
    if (byKey) return byKey
  }

  const target = normalizeBaseUrl(current.baseUrl)
  if (!target) return undefined
  return coding.find(
    (provider) => normalizeBaseUrl(provider.baseUrl) === target,
  )
}
