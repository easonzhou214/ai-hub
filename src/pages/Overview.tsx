import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import type { PageKey, Provider, ProviderType } from '../types'
import {
  formatMoney,
  formatNumber,
  getQuotaState,
  getStatus,
  isInterfaceSynced,
  relativeTime,
  sumInUSD,
} from '../utils'
import { ProviderCard } from '../components/ProviderCard'
import { EmptyState, SectionHead, Tabs } from '../components/ui'

type Filter = 'all' | ProviderType

interface OverviewProps {
  providers: Provider[]
  lastSyncedAt: string
  onEdit: (provider: Provider) => void
  onAdd: (type?: ProviderType) => void
  onNavigate: (page: PageKey) => void
  onLogin: (provider: Provider) => void
  loginBusyId?: string
}

const STATUS_ORDER: Record<string, number> = {
  expired: 0,
  expiring: 1,
  warning: 2,
  login: 3,
  error: 4,
  unknown: 5,
  healthy: 6,
  disabled: 7,
}

export function Overview({
  providers,
  lastSyncedAt,
  onEdit,
  onAdd,
  onNavigate,
  onLogin,
  loginBusyId,
}: OverviewProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const enabled = providers.filter((provider) => provider.enabled)

  const stats = useMemo(() => {
    const usedUSD = sumInUSD(enabled, (provider) =>
      provider.syncMode === 'openai-billing' &&
      provider.lifetimeUsed !== undefined
        ? provider.lifetimeUsed
        : provider.billing === 'quota'
          ? provider.quotaUsed
          : provider.monthlySpend,
    )
    const quotaAvailableUSD = sumInUSD(
      enabled.filter((provider) => provider.billing === 'quota'),
      (provider) => getQuotaState(provider).available,
    )
    const balanceUSD = sumInUSD(
      enabled.filter((provider) => provider.billing === 'balance'),
      (provider) => provider.balance,
    )
    const calls = enabled.reduce(
      (total, provider) => total + provider.callsToday,
      0,
    )
    const weightedSuccess =
      calls > 0
        ? enabled.reduce(
            (total, provider) =>
              total + provider.callsToday * provider.successRate,
            0,
          ) / calls
        : 0
    const attention = enabled.filter((provider) => {
      const status = getStatus(provider)
      return (
        status === 'warning' ||
        status === 'expiring' ||
        status === 'expired' ||
        status === 'unknown' ||
        status === 'login' ||
        status === 'error'
      )
    }).length
    const synced = enabled.filter(isInterfaceSynced)
    return {
      usedUSD,
      availableUSD: quotaAvailableUSD + balanceUSD,
      quotaAvailableUSD,
      balanceUSD,
      calls,
      weightedSuccess: weightedSuccess * 100,
      attention,
      syncedCount: synced.length,
      manualCount: enabled.length - synced.length,
      unlimitedCount: enabled.filter(
        (provider) => provider.unlimited && !provider.limitUnknown,
      ).length,
      unknownCount: enabled.filter((provider) => provider.limitUnknown).length,
      syncErrorCount: synced.filter((provider) => provider.syncError).length,
    }
  }, [enabled])

  const counts = useMemo(
    () => ({
      all: providers.length,
      coding: providers.filter((provider) => provider.type === 'coding').length,
      image: providers.filter((provider) => provider.type === 'image').length,
    }),
    [providers],
  )

  const visibleProviders = useMemo(() => {
    const list =
      filter === 'all'
        ? providers
        : providers.filter((provider) => provider.type === filter)
    return [...list].sort((a, b) => {
      const statusDiff = STATUS_ORDER[getStatus(a)] - STATUS_ORDER[getStatus(b)]
      if (statusDiff !== 0) return statusDiff
      const percentA = getQuotaState(a).percent ?? -1
      const percentB = getQuotaState(b).percent ?? -1
      return percentB - percentA
    })
  }, [providers, filter])

  const enabledCoding = enabled.filter((p) => p.type === 'coding').length
  const enabledImage = enabled.filter((p) => p.type === 'image').length

  return (
    <div className="page overview-page">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>概览</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('usage')}
          >
            <Icon name="chart" size={14} />
            额度明细
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onAdd()}>
            <Icon name="plus" size={14} />
            添加供应商
          </button>
        </div>
      </div>

      <section className="stat-grid" aria-label="额度总览">
        <StatCard
          tone="sand"
          label="已用额度"
          value={formatMoney(stats.usedUSD, 'USD')}
          foot={
            stats.syncedCount > 0
              ? stats.manualCount > 0
                ? '手动额度 + 接口账户累计用量'
                : '接口账户累计用量'
              : '周期已用 + 本月消耗'
          }
        />
        <StatCard
          tone="aqua"
          label="可用总额度"
          value={formatMoney(stats.availableUSD, 'USD')}
          foot={
            stats.unknownCount > 0
              ? `有限额度合计 · ${stats.unknownCount} 个额度待确认`
              : stats.unlimitedCount > 0
                ? `有限额度合计 · ${stats.unlimitedCount} 个不限额度`
                : `周期 ${formatMoney(stats.quotaAvailableUSD, 'USD')} · 余额 ${formatMoney(stats.balanceUSD, 'USD')}`
          }
        />
        {stats.syncedCount > 0 ? (
          <StatCard
            tone="mint"
            label="接口同步"
            value={`${stats.syncedCount}`}
            suffix={`/ ${enabled.length}`}
            foot={`供应商接口 · ${relativeTime(lastSyncedAt)}${
              stats.syncErrorCount > 0
                ? ` · ${stats.syncErrorCount} 个失败`
                : ''
            }`}
          />
        ) : (
          <StatCard
            tone="mint"
            label="今日调用"
            value={formatNumber(stats.calls)}
            foot={`请求成功率 ${stats.weightedSuccess.toFixed(1)}% · 来自 ${enabled.length} 个供应商`}
          />
        )}
        <StatCard
          tone="lilac"
          label="活跃供应商"
          value={`${enabled.length}`}
          suffix={`/ ${providers.length}`}
          foot={`编程 ${enabledCoding} · 绘图 ${enabledImage}${
            stats.attention > 0 ? ` · ${stats.attention} 个待关注` : ' · 状态良好'
          }`}
        />
      </section>

      <section className="providers-section">
        <SectionHead
          title="供应商额度"
          description="按使用率排序，优先展示即将到期、额度紧张或待确认的供应商"
        >
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel="按类型筛选供应商"
            options={[
              { value: 'all', label: '全部', count: counts.all },
              { value: 'coding', label: '编程', count: counts.coding },
              { value: 'image', label: '绘图', count: counts.image },
            ]}
          />
          <button
            type="button"
            className="text-button section-link"
            onClick={() => onNavigate('providers')}
          >
            管理全部
            <Icon name="arrow-right" size={13} />
          </button>
        </SectionHead>

        {visibleProviders.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon="server"
              title={providers.length === 0 ? '还没有配置供应商' : '这个分类下暂时为空'}
              description={
                providers.length === 0
                  ? '添加第一个编程或绘图供应商，额度会出现在这里。'
                  : '切换到其他分类，或添加一个该类型的供应商。'
              }
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    onAdd(filter === 'all' ? undefined : filter)
                  }
                >
                  <Icon name="plus" size={14} />
                  添加供应商
                </button>
              }
            />
          </div>
        ) : (
          <div className="provider-grid">
            {visibleProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onEdit={onEdit}
                onLogin={onLogin}
                loginBusy={loginBusyId === provider.sourceId}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  tone,
  label,
  value,
  suffix,
  foot,
}: {
  tone: 'sand' | 'aqua' | 'mint' | 'lilac'
  label: string
  value: string
  suffix?: string
  foot: string
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <div className="stat-label">
        <span className="stat-dot" />
        {label}
      </div>
      <div className="stat-value">
        {value}
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </div>
      <p className="stat-foot">{foot}</p>
    </article>
  )
}
