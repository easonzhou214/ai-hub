import { hostname, networkInterfaces, platform } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { remoteSyncAllowed } from './remote-access'

/**
 * 运行环境自述。
 *
 * 浏览器永远不知道「我是不是跑服务的这台机器」：页面里的每个请求都是发给服务
 * 端进程的，由它去读 CC Switch、拉起 headless Chrome。所以同一份页面在服务器
 * 上和在手机上打开，行为并不一样：
 *
 * - 本机（回环地址）：/api/cc-switch/* 全部可用，同步真正执行。
 * - 客户端（局域网其他设备）：这几个接口按设计只允许回环，返回 403。同步点
 *   下去必然失败，前端应该提前说明而不是让用户等一轮超时。
 * - 静态部署（只有 dist）：/api/* 根本不存在，同样无法同步。
 *
 * 这个接口把「谁在处理请求、能不能同步」告诉前端，前端据此决定按钮状态，并在
 * 提示里写清楚额度是哪台机器读到的。
 */

const RUNTIME_ROUTE = '/api/runtime'

export interface RuntimeInfo {
  /** server = 请求来自本机回环；client = 来自其他设备 */
  role: 'server' | 'client'
  hostname: string
  platform: string
  /** 服务端自己的局域网地址，客户端用它来确认连的是哪台机器 */
  addresses: string[]
  mode: 'dev' | 'preview'
  /** 是否允许客户端触发同步（AIHUB_ALLOW_REMOTE_SYNC=1） */
  syncFromClient: boolean
  serverTime: string
}

function isLoopback(request: IncomingMessage) {
  const address = request.socket.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address === '::ffff:::1'
  )
}

function lanAddresses() {
  const result: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) result.push(entry.address)
    }
  }
  return result
}

function sendJson(response: ServerResponse, payload: unknown) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

function runtimeMiddleware(mode: 'dev' | 'preview') {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    const path = (request.url ?? '').split('?')[0]
    if (path !== RUNTIME_ROUTE) {
      next()
      return
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      response.statusCode = 405
      response.end()
      return
    }

    const info: RuntimeInfo = {
      role: isLoopback(request) ? 'server' : 'client',
      hostname: hostname(),
      platform: platform(),
      addresses: lanAddresses(),
      mode,
      syncFromClient: remoteSyncAllowed(),
      serverTime: new Date().toISOString(),
    }
    sendJson(response, info)
  }
}

export function runtimePlugin(): Plugin {
  return {
    name: 'ai-hub:runtime',
    configureServer(server) {
      server.middlewares.use(runtimeMiddleware('dev'))
    },
    configurePreviewServer(server) {
      server.middlewares.use(runtimeMiddleware('preview'))
    },
  }
}
