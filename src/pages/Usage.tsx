import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import type { PageKey, Provider, ProviderType } from '../types'
import {
  formatMoney,
  formatPercent,
  formatQuota,
  getQuotaState,
  getStatus,
  isGenerationQuota,
  isInterfaceSynced,
  loginBrand,
  logoText,
  relativeTime,
  remainingPercent,
  toUSD,
  expiryLabel,
  cx,
} from '../utils'
import {
  EmptyState,
  ProgressBar,
  ProviderLogo,
  SectionHead,
  StatusBadge,
  Tabs,
  TypeChip,
  usageTone,
} from '../components/ui'

type Filter = 'all' | ProviderType

interface UsagePageProps {
  providers: Provider[]
  onEdit: (provider: Provider) => void
  onNavigate: (page: PageKey) => void
}

const TYPE_COLOR: Record<ProviderType, string> = {
  coding: '#5B7CFA',
  image: '#E879A9',
}

interface CompositionItem {
  key: string
  label: string
  color: string
  value: number
  badge: string
  /** 仅在按类型汇总时补充「已用」；按供应商拆分时只保留占比，来源信息在额度明细里 */
  meta?: string
}

export function UsagePage({
  providers,
  onEdit,
  onNavigate,
}: UsagePageProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const enabled = providers.filter((provider) => provider.enabled)

  const summary = useMemo(() => {
    const quotaProviders = enabled.filter((p) => p.billing === 'quota')
    const finiteQuotaProviders = quotaProviders.filter(
      (p) =>
        !p.unlimited &&
        !p.limitUnknown &&
        (p.quotaTotal > 0 || p.accountBalance !== undefined),
    )
    const balanceProviders = enabled.filter((p) => p.billing === 'balance')
    const quotaAvailable = finiteQuotaProviders.reduce(
      (total, provider) =>
        isGenerationQuota(provider)
          ? total
          : total + toUSD(getQuotaState(provider).available, provider.currency),
      0,
    )
    const balanceAvailable = balanceProviders.reduce(
      (total, provider) =>
        total + toUSD(provider.balance, provider.currency),
      0,
    )
    const synced = enabled.filter(isInterfaceSynced)
    const expiring = enabled.filter((p) => getStatus(p) === 'expiring').length
    const warning = enabled.filter((p) => getStatus(p) === 'warning').length
    const expired = enabled.filter((p) => getStatus(p) === 'expired').length
    const errorCount = enabled.filter((p) => getStatus(p) === 'error').length
    const loginCount = enabled.filter((p) => getStatus(p) === 'login').length
    const totalUsed = enabled.reduce(
      (total, provider) =>
        isGenerationQuota(provider)
          ? total
          : total +
            toUSD(
              provider.syncMode === 'openai-billing' &&
                provider.lifetimeUsed !== undefined
                ? provider.lifetimeUsed
                : provider.billing === 'quota'
                  ? provider.quotaUsed
                  : provider.monthlySpend,
              provider.currency,
            ),
      0,
    )
    return {
      quotaAvailable,
      balanceAvailable,
      quotaCount: quotaProviders.length,
      finiteQuotaCount: finiteQuotaProviders.length,
      usdQuotaCount: finiteQuotaProviders.filter(
        (provider) => !isGenerationQuota(provider),
      ).length,
      balanceCount: balanceProviders.length,
      unlimitedCount: enabled.filter(
        (p) => p.unlimited && !p.limitUnknown,
      ).length,
      unknownCount: enabled.filter((p) => p.limitUnknown).length,
      syncedCount: synced.length,
      syncErrorCount: synced.filter((p) => p.syncError).length,
      expiring,
      warning,
      expired,
      errorCount,
      loginCount,
      totalAvailable: quotaAvailable + balanceAvailable,
      totalUsed,
    }
  }, [enabled])

  const typeComposition = (['coding', 'image'] as ProviderType[]).map(
    (type) => {
      const list = enabled.filter((provider) => provider.type === type)
      const usdList = list.filter((provider) => !isGenerationQuota(provider))
      const available = usdList.reduce((total, provider) => {
        const quota = getQuotaState(provider)
        return total + toUSD(quota.available, provider.currency)
      }, 0)
      const used = usdList.reduce(
        (total, provider) =>
          total +
          toUSD(
            provider.syncMode === 'openai-billing' &&
              provider.lifetimeUsed !== undefined
              ? provider.lifetimeUsed
              : provider.billing === 'quota'
                ? provider.quotaUsed
                : provider.monthlySpend,
            provider.currency,
          ),
        0,
      )
      return { type, count: list.length, available, used }
    },
  )

  const usageMode = summary.syncedCount > 0
  const compositionProviders = enabled.filter(
    (provider) => !isGenerationQuota(provider),
  )
  const generationQuotaCount = enabled.filter(isGenerationQuota).length
  const compositionItems: CompositionItem[] = usageMode
    ? compositionProviders
        .map((provider) => ({
          key: provider.id,
          label: provider.name,
          color: provider.color,
          value: toUSD(
            provider.syncMode === 'openai-billing' &&
              provider.lifetimeUsed !== undefined
              ? provider.lifetimeUsed
              : provider.billing === 'quota'
                ? provider.quotaUsed
                : provider.monthlySpend,
            provider.currency,
          ),
          badge: provider.type === 'coding' ? '编程' : '绘图',
        }))
        .sort((a, b) => b.value - a.value)
    : typeComposition.map((item) => ({
        key: item.type,
        label:
          item.type === 'coding' ? '编程供应商' : '绘图供应商',
        color: TYPE_COLOR[item.type],
        value: item.available,
        badge: `${item.count} 个`,
        meta: `已用 ${formatMoney(item.used, 'USD')}`,
      }))
  const compositionTotal = compositionItems.reduce(
    (total, item) => total + item.value,
    0,
  )
  let donutCursor = 0
  const donutStops = compositionItems.map((item) => {
    const start = donutCursor
    donutCursor +=
      compositionTotal > 0 ? (item.value / compositionTotal) * 100 : 0
    return `${item.color} ${start.toFixed(2)}% ${donutCursor.toFixed(2)}%`
  })
  const donutBackground =
    compositionTotal > 0
      ? `conic-gradient(${donutStops.join(', ')})`
      : 'conic-gradient(#e9ecef 0% 100%)'
  const compositionLabel = usageMode ? '累计用量' : '可用总额度'
  const donutAria = `${compositionLabel} ${formatMoney(compositionTotal, 'USD')}`

  const counts = {
    all: providers.length,
    coding: providers.filter((p) => p.type === 'coding').length,
    image: providers.filter((p) => p.type === 'image').length,
  }

  const rows = useMemo(() => {
    const list =
      filter === 'all'
        ? providers
        : providers.filter((provider) => provider.type === filter)
    return [...list].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      const percentA = getQuotaState(a).percent ?? -1
      const percentB = getQuotaState(b).percent ?? -1
      return percentB - percentA
    })
  }, [providers, filter])

  return (
    <div className="page usage-page">
      <div className="page-head">
        <div className="page-head-copy">
          <h1>使用额度</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('providers')}
          >
            <Icon name="server" size={14} />
            管理供应商
          </button>
        </div>
      </div>

      <section className="summary-grid" aria-label="额度汇总">
        <article className="summary-card">
          <span className="summary-icon mint">
            <Icon name="calendar" size={17} />
          </span>
          <div>
            <p className="summary-label">
              {summary.syncedCount > 0 ? '可用额度' : '周期额度剩余'}
            </p>
            <p className="summary-value">
              {formatMoney(summary.totalAvailable, 'USD')}
            </p>
            <p className="summary-foot">
              {generationQuotaCount > 0
                ? `${summary.usdQuotaCount} 个美元账户 · ${generationQuotaCount} 个按次账户${
                    summary.unknownCount > 0
                      ? ` · ${summary.unknownCount} 个待确认`
                      : ''
                  }`
                : summary.unknownCount > 0
                  ? `${summary.finiteQuotaCount} 个有限额度账户 · ${summary.unknownCount} 个额度待确认`
                  : `${summary.finiteQuotaCount} 个有限额度账户${
                      summary.unlimitedCount > 0
                        ? ` · ${summary.unlimitedCount} 个不限额度`
                        : ' · 已折算为美元'
                    }`}
            </p>
          </div>
        </article>
        {summary.syncedCount > 0 ? (
          <article className="summary-card">
            <span className="summary-icon sand">
              <Icon name="refresh" size={17} />
            </span>
            <div>
              <p className="summary-label">累计已用</p>
              <p className="summary-value">
                {formatMoney(summary.totalUsed, 'USD')}
              </p>
              <p className="summary-foot">
                供应商接口 · {summary.syncedCount} 个账户
                {summary.syncErrorCount > 0
                  ? ` · ${summary.syncErrorCount} 个同步失败`
                  : ''}
              </p>
            </div>
          </article>
        ) : (
          <article className="summary-card">
            <span className="summary-icon sand">
              <Icon name="wallet" size={17} />
            </span>
            <div>
              <p className="summary-label">充值余额合计</p>
              <p className="summary-value">
                {formatMoney(summary.balanceAvailable, 'USD')}
              </p>
              <p className="summary-foot">
                覆盖 {summary.balanceCount} 个余额型供应商 · 统一折算美元
              </p>
            </div>
          </article>
        )}
        <article className="summary-card">
          <span className="summary-icon rose">
            <Icon name="alert" size={17} />
          </span>
          <div>
            <p className="summary-label">需要关注</p>
            <p className="summary-value">
              {summary.expiring +
                summary.warning +
                summary.expired +
                summary.errorCount +
                summary.loginCount +
                summary.unknownCount}
              <span className="summary-unit"> 个</span>
            </p>
            <p className="summary-foot">
              {summary.expiring +
                summary.warning +
                summary.expired +
                summary.errorCount +
                summary.loginCount +
                summary.unknownCount ===
              0
                ? '所有启用供应商状态良好'
                : [
                    summary.expired > 0 ? `${summary.expired} 个已过期` : '',
                    summary.expiring > 0 ? `${summary.expiring} 个即将到期` : '',
                    summary.warning > 0 ? `${summary.warning} 个额度紧张` : '',
                    summary.errorCount > 0
                      ? `${summary.errorCount} 个同步失败`
                      : '',
                    summary.loginCount > 0
                      ? `${summary.loginCount} 个需要登录`
                      : '',
                    summary.unknownCount > 0
                      ? `${summary.unknownCount} 个额度待确认`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
        </article>
      </section>

      <section className="panel composition-panel">
        <div className="panel-head">
          <div className="section-copy">
            <h2>{usageMode ? '用量构成' : '额度构成'}</h2>
            <p>
              {usageMode
                ? '按接口与手动记录的累计用量统计，其他币种按 $1 = ¥7.2 折算'
                : '按剩余可用额度统计，其他币种按 $1 = ¥7.2 折算'}
              {generationQuotaCount > 0 &&
                `；${generationQuotaCount} 个按次计费账户（如 PixelLab）不计入美元构成，见下方明细`}
            </p>
          </div>
          <span className="soft-pill">
            <Icon name={usageMode ? 'refresh' : 'layers'} size={12} />
            {usageMode ? '接口账户' : '编程与绘图'}
          </span>
        </div>

        <div className="composition-body">
          <div className="donut-wrap">
            <div
              className="donut"
              style={{ background: donutBackground }}
              role="img"
              aria-label={donutAria}
            >
              <div className="donut-hole">
                <span>{compositionLabel}</span>
                <strong>{formatMoney(compositionTotal, 'USD')}</strong>
                <em>已折算为美元</em>
              </div>
            </div>
            <div
              className="donut-legend-inline"
              aria-hidden="true"
            >
              {compositionItems.map((item) => (
                <span key={item.key}>
                  <i style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="composition-legend">
            {compositionItems.map((item) => {
              const share =
                compositionTotal > 0
                  ? (item.value / compositionTotal) * 100
                  : 0
              return (
                <div className="composition-item" key={item.key}>
                  <div className="composition-line">
                    <span className="composition-name">
                      <i style={{ background: item.color }} />
                      {item.label}
                      <span className="composition-count">{item.badge}</span>
                    </span>
                    <span className="composition-available">
                      {usageMode ? '累计' : '可用'}{' '}
                      {formatMoney(item.value, 'USD')}
                    </span>
                  </div>
                  <div className="share-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(Math.min(share, 100), item.value > 0 ? 2 : 0)}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                  <div className="composition-meta">
                    {item.meta ? <span>{item.meta}</span> : null}
                    <span>
                      {usageMode ? '占累计用量' : '占可用额度'}{' '}
                      {compositionTotal > 0 ? formatPercent(share) : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="usage-detail">
        <SectionHead
          title="额度明细"
          description="按剩余额度从低到高排序，点击行可编辑供应商"
        >
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            ariaLabel="按类型筛选额度明细"
            options={[
              { value: 'all', label: '全部', count: counts.all },
              { value: 'coding', label: '编程', count: counts.coding },
              { value: 'image', label: '绘图', count: counts.image },
            ]}
          />
        </SectionHead>

        <div className="panel usage-table-panel">
          {providers.length === 0 ? (
            <EmptyState
              icon="chart"
              title="还没有额度数据"
              description="先在供应商页面添加供应商，额度明细会自动汇总到这里。"
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onNavigate('providers')}
                >
                  <Icon name="plus" size={14} />
                  去添加供应商
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="search"
              title="这个分类下暂无供应商"
              description="切换其他类型筛选，查看对应的额度明细。"
            />
          ) : (
            <div className="usage-table">
              <div className="ut-head">
                <span>供应商</span>
                <span>类型</span>
                <span>剩余额度</span>
                <span>可用 / 余额</span>
                <span>重置与同步</span>
                <span>状态</span>
              </div>
              {rows.map((provider) => {
                const quota = getQuotaState(provider)
                const remaining = remainingPercent(quota.percent)
                const status = getStatus(provider)
                const expiry = expiryLabel(provider)
                const synced = isInterfaceSynced(provider)
                const needsLogin = Boolean(
                  provider.loginRequired && provider.loginProvider,
                )
                const unlimited = Boolean(provider.unlimited)
                const unknown = Boolean(provider.limitUnknown)
                const hasPlanQuota =
                  quota.percent !== null && quota.total !== null
                const hasWallet = provider.accountBalance !== undefined
                const hasAccountBalance = hasWallet && !hasPlanQuota
                const hasBoth = hasPlanQuota && hasWallet
                const planBased = Boolean(
                  synced &&
                    quota.percent !== null &&
                    (provider.resetAt ||
                      provider.syncMode === 'pixellab'),
                )
                const noData = Boolean(
                  provider.syncError &&
                    provider.quotaTotal <= 0 &&
                    provider.accountBalance === undefined &&
                    !provider.lifetimeUsed,
                )
                const cumulative = provider.lifetimeUsed ?? quota.used
                const lastSync = provider.lastSyncedAt
                  ? relativeTime(provider.lastSyncedAt)
                  : ''
                const money = (value: number) =>
                  formatMoney(value, provider.currency)
                return (
                  <div
                    key={provider.id}
                    className={cx(
                      'ut-row',
                      !provider.enabled && 'is-disabled',
                    )}
                    role="button"
                    tabIndex={0}
                    aria-label={`编辑 ${provider.name}`}
                    onClick={() => onEdit(provider)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onEdit(provider)
                      }
                    }}
                  >
                    <div className="ut-provider">
                      <ProviderLogo
                        text={logoText(provider)}
                        color={provider.color}
                        size="sm"
                      />
                      <div>
                        <strong>{provider.name}</strong>
                        <span>
                          {provider.vendor} ·{' '}
                          {synced
                            ? needsLogin
                              ? '接口账户 · 待登录'
                              : unknown
                                ? '接口账户 · 待授权'
                                : planBased
                                  ? '接口账户 · 周期额度'
                                  : hasAccountBalance
                                    ? '接口账户 · 余额'
                                    : '接口账户'
                            : provider.billing === 'quota'
                              ? '周期额度'
                              : '充值余额'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <TypeChip type={provider.type} />
                    </div>
                    <div className="ut-usage">
                      <div className="ut-usage-head">
                        <span>
                          {needsLogin ? (
                            <>
                              需要登录
                              <em> · {loginBrand(provider)} 网页登录后读取</em>
                            </>
                          ) : noData ? (
                            <>
                              读取失败
                              <em> · 账户额度</em>
                            </>
                          ) : unknown ? (
                            <>
                              待确认
                              <em> · 累计 {money(cumulative)}</em>
                            </>
                          ) : hasAccountBalance ? (
                            <>
                              {money(provider.accountBalance ?? 0)}
                              <em> · 累计已用 {money(cumulative)}</em>
                            </>
                          ) : unlimited ? (
                            <>
                              不限额度
                              <em> · 累计 {money(cumulative)}</em>
                            </>
                          ) : (
                            <>
                              {formatPercent(remaining)}
                              {quota.total !== null && (
                                <em>
                                  {' '}
                                  · 已用 {formatQuota(quota.used, provider)} /{' '}
                                  {formatQuota(quota.total, provider)}
                                </em>
                              )}
                            </>
                          )}
                        </span>
                        <span className="ut-reset-inline">
                          {needsLogin
                            ? '需要登录'
                            : noData
                              ? '同步失败'
                              : unknown
                                ? '账户额度'
                                : hasAccountBalance
                              ? '账户余额'
                              : unlimited
                                ? '供应商接口'
                                : quota.label}
                        </span>
                      </div>
                      {needsLogin ? (
                        <div
                          className="unlimited-bar is-login ut-unlimited-bar"
                          aria-hidden="true"
                        >
                          <span />
                        </div>
                      ) : noData ? (
                        <div
                          className="unlimited-bar is-error ut-unlimited-bar"
                          aria-hidden="true"
                        >
                          <span />
                        </div>
                      ) : unknown ? (
                        <div
                          className="unlimited-bar is-unknown ut-unlimited-bar"
                          aria-hidden="true"
                        >
                          <span />
                        </div>
                      ) : hasAccountBalance || unlimited ? (
                        <div
                          className="unlimited-bar ut-unlimited-bar"
                          aria-hidden="true"
                        >
                          <span />
                        </div>
                      ) : (
                        <ProgressBar
                          value={remaining}
                          tone={usageTone(quota.percent)}
                          thin
                          label={`${provider.name} 剩余额度`}
                        />
                      )}
                      {hasBoth && (
                        <span className="ut-wallet-sub">
                          <Icon name="wallet" size={11} />
                          钱包余额 {money(provider.accountBalance ?? 0)}
                        </span>
                      )}
                    </div>
                    <div className="ut-available">
                      <strong>
                        {needsLogin
                          ? '—'
                          : noData
                            ? '—'
                            : unknown
                              ? '待确认'
                              : hasAccountBalance
                            ? money(provider.accountBalance ?? 0)
                            : unlimited
                              ? '不限额度'
                              : formatQuota(quota.available, provider)}
                      </strong>
                      <span>
                        {needsLogin
                          ? '需要登录'
                          : noData
                            ? '同步失败'
                            : unknown
                              ? '账户额度未授权'
                              : hasAccountBalance
                            ? '账户余额'
                            : unlimited
                              ? '供应商接口'
                              : provider.billing === 'quota'
                                ? planBased
                                  ? '周期剩余'
                                  : synced
                                    ? '账户剩余'
                                    : '剩余额度'
                                : '当前余额'}
                      </span>
                    </div>
                    <div className="ut-reset">
                      {synced ? (
                        <>
                          <span>
                            {provider.syncError
                              ? '同步失败'
                              : planBased
                                ? provider.resetAt
                                  ? resetText(provider.resetAt)
                                  : '按月重置'
                                : '接口同步'}
                          </span>
                          <span
                            className={cx(
                              provider.syncError
                                ? 'ut-expiry'
                                : undefined,
                            )}
                            title={provider.syncError || undefined}
                          >
                            {provider.syncError
                              ? '点开查看配置'
                              : lastSync
                                ? `${lastSync}同步`
                                : '等待首次同步'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            {provider.billing === 'quota'
                              ? resetText(provider.resetAt)
                              : '无周期重置'}
                          </span>
                          <span className={cx(expiry && 'ut-expiry')}>
                            {expiry ?? '长期有效'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="ut-status">
                      <StatusBadge status={status} />
                      <Icon name="chevron-right" size={14} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function resetText(isoDate: string) {
  if (!isoDate) return '未设置重置'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '未设置重置'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日重置`
}
