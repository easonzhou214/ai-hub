import { hostname, networkInterfaces, platform } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * 运行环境自述。
 *
 * 浏览器永远不知道「我是不是跑服务的这台机器」：页面里的每个请求都是发给服务
 * 端进程的。这个接口按连接的来源地址判断，回环就是本机，其他就是客户端。
 *
 * 用途：
 * - 客户端不能导入 CC Switch（响应里带 API Key）、不能拉起本机登录窗口，
 *   界面据此把这两个入口说明清楚；额度同步则是任何设备都能触发的，服务端代劳。
 * - 纯静态部署时接口不存在，前端也知道自己只剩 localStorage。
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
