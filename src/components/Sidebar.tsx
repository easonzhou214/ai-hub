import { Icon } from '../icons'
import type { PageKey } from '../types'
import { cx } from '../utils'

interface SidebarProps {
  page: PageKey
  providerCount: number
  onNavigate: (page: PageKey) => void
}

const NAV_ITEMS: Array<{
  key: PageKey
  label: string
  icon: 'grid' | 'server' | 'chart'
  hint: string
}> = [
  { key: 'overview', label: '概览', icon: 'grid', hint: '额度与调用总览' },
  { key: 'providers', label: '供应商', icon: 'server', hint: '配置编程与绘图供应商' },
  { key: 'usage', label: '使用额度', icon: 'chart', hint: '额度构成与明细' },
]

export function Sidebar({
  page,
  providerCount,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <nav className="nav" aria-label="主导航">
          <p className="nav-label">工作台</p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cx('nav-item', page === item.key && 'active')}
              aria-current={page === item.key ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
              title={item.hint}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.key === 'providers' && (
                <span className="nav-count">{providerCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-foot">
            <span className="local-dot" />
            本地优先 · 仅存本机
          </div>
        </div>
      </div>
    </aside>
  )
}
