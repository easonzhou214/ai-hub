import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * 服务端状态存储。
 *
 * 浏览器里的供应商、额度、账号原本只存在 localStorage，换一个地址（或换一台
 * 设备）就是另一份数据。这里把所有共享状态收进一个 JSON 文件，通过
 * GET/PUT /api/state 暴露给前端，前端仍然保留 localStorage 作为离线缓存。
 *
 * - 每次写入递增 revision；客户端带 baseRevision，不匹配返回 409，避免两台
 *   设备同时写把对方的修改悄悄覆盖掉。
 * - 文件默认落在 <cwd>/.local/hub-state.json（已在 .gitignore 中），可用
 *   AIHUB_STATE_FILE 覆盖。注意文件里含 API Key 明文，权限设为 0600。
 * - 该接口不做鉴权：能打开页面的人本来就能在界面里看到这些配置。公网部署
 *   请自备反向代理鉴权。
 */

const STATE_ROUTE = '/api/state'
const STATE_FILE =
  process.env.AIHUB_STATE_FILE?.trim() ||
  join(process.cwd(), '.local', 'hub-state.json')
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_PROVIDERS = 200
const MAX_ACCOUNTS = 50

interface StateRecord {
  version: 1
  revision: number
  updatedAt: string
  providers: unknown[]
  accounts: unknown[]
  lastSyncedAt: string
  autoSync: boolean
}

function emptyState(): StateRecord {
  return {
    version: 1,
    revision: 0,
    updatedAt: '',
    providers: [],
    accounts: [],
    lastSyncedAt: '',
    autoSync: true,
  }
}

function isProvider(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    (item.type === 'coding' || item.type === 'image')
  )
}

function isAccount(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.username === 'string' &&
    typeof item.passwordHash === 'string' &&
    (item.role === 'admin' || item.role === 'member')
  )
}

function readState(): StateRecord | null {
  if (!existsSync(STATE_FILE)) return null
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<StateRecord>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      version: 1,
      revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter(isProvider)
        : [],
      accounts: Array.isArray(parsed.accounts)
        ? parsed.accounts.filter(isAccount)
        : [],
      lastSyncedAt:
        typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : '',
      autoSync:
        typeof parsed.autoSync === 'boolean' ? parsed.autoSync : true,
    }
  } catch {
    return null
  }
}

function writeState(state: StateRecord) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  const temp = `${STATE_FILE}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, STATE_FILE)
}

let writeChain: Promise<void> = Promise.resolve()

function queueWrite(state: StateRecord) {
  const next = writeChain.then(() => writeState(state))
  writeChain = next.catch(() => undefined)
  return next
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

function readJsonBody(request: IncomingMessage, limit = MAX_BODY_BYTES) {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

/**
 * 状态写入的串行队列。
 *
 * revision 乐观锁必须是「读 → 比较 → 写」一体的临界区：早先读在请求开头、
 * 写才进队列，两台设备同时 PUT 会双双通过校验，后写的静默覆盖前写的。
 */
let stateLock: Promise<unknown> = Promise.resolve()

function withStateLock<T>(task: () => Promise<T>): Promise<T> {
  const run = stateLock.then(task, task)
  stateLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function handleState(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === 'GET') {
    const stored = readState()
    sendJson(response, 200, { ...(stored ?? emptyState()), empty: stored === null })
    return
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, PUT')
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法读取请求体'
    sendJson(response, 413, { error: message })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(response, 400, { error: '缺少状态内容' })
    return
  }

  const record = body as Record<string, unknown>
  const providers = record.providers
  if (
    !Array.isArray(providers) ||
    providers.length > MAX_PROVIDERS ||
    !providers.every(isProvider)
  ) {
    sendJson(response, 400, { error: '供应商数据格式不正确' })
    return
  }

  const accounts = Array.isArray(record.accounts)
    ? record.accounts.filter(isAccount).slice(0, MAX_ACCOUNTS)
    : []
  const baseRevision = Number.isFinite(record.baseRevision)
    ? Number(record.baseRevision)
    : null

  const outcome = await withStateLock(async () => {
    const stored = readState()
    const state = stored ?? emptyState()
    const currentRevision = state.revision

    if (baseRevision !== null && baseRevision !== currentRevision) {
      return {
        status: 409 as const,
        payload: {
          error: 'revision-mismatch',
          state: { ...state, empty: stored === null },
        },
      }
    }

    const next: StateRecord = {
      version: 1,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
      providers,
      accounts,
      lastSyncedAt:
        typeof record.lastSyncedAt === 'string' ? record.lastSyncedAt : '',
      autoSync: typeof record.autoSync === 'boolean' ? record.autoSync : true,
    }

    await queueWrite(next)
    return {
      status: 200 as const,
      payload: { revision: next.revision, updatedAt: next.updatedAt },
    }
  })

  sendJson(response, outcome.status, outcome.payload)
}

function stateMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) {
  let pathname: string
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    next()
    return
  }

  if (pathname !== STATE_ROUTE) {
    next()
    return
  }

  void handleState(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '状态存储异常'
    if (!response.headersSent) {
      sendJson(response, 500, { error: message })
    } else {
      response.end()
    }
  })
}

export function stateStorePlugin(): Plugin {
  return {
    name: 'ai-hub:state-store',
    configureServer(server) {
      server.middlewares.use(stateMiddleware)
      server.config.logger.info(
        `[ai-hub] 状态存储文件：${STATE_FILE}`,
      )
    },
    configurePreviewServer(server) {
      server.middlewares.use(stateMiddleware)
      server.config.logger.info(
        `[ai-hub] 状态存储文件：${STATE_FILE}`,
      )
    },
  }
}
