import { BrandMark } from './ui'

export function BootScreen({ message }: { message: string }) {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-glow" aria-hidden="true" />
      <div className="boot-card">
        <BrandMark size={38} />
        <div className="boot-copy">
          <strong>AI Hub</strong>
          <span>{message}</span>
        </div>
        <span className="boot-spinner" aria-hidden="true" />
      </div>
      <p className="boot-note">
        正在读取本机 CC Switch 配置 · 密钥仅保存在此浏览器
      </p>
    </div>
  )
}
