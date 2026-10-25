/**
 * 是否允许非回环（其他设备）调用 CC Switch 相关接口。
 *
 * 这些接口能读到本机的 API Key、浏览器登录态，默认只接受本机请求，客户端一律
 * 403。要在手机 / 另一台电脑上也能点同步，启动时带上：
 *
 *   AIHUB_ALLOW_REMOTE_SYNC=1 npm run serve
 *
 * 放开的代价是同一网段的任何人都能触发读取（读到的仍是服务端那台机器的配置）。
 * 每次调用都现读环境变量，方便测试和热改。
 */
export function remoteSyncAllowed() {
  const raw = process.env.AIHUB_ALLOW_REMOTE_SYNC?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}
