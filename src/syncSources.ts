import type { ProviderType, SyncMode } from './types'

/** 除手动录入与 CC Switch 之外的额度同步来源。 */
export type SyncSourceId = Exclude<SyncMode, 'manual' | 'openai-billing'>

export interface SyncSourceOption {
  id: SyncSourceId
  /** 下拉里显示的名字 */
  label: string
  /** 选中后的一行说明 */
  summary: string
  /** 只在这些供应商类型下提供 */
  types: ProviderType[]
}

/**
 * 新增一个「用 API Key 查额度」的供应商时，在这里加一项，
 * 再在 billing.ts 的 fetchProviderBilling 里接上对应适配器即可。
 */
export const SYNC_SOURCES: SyncSourceOption[] = [
  {
    id: 'pixellab',
    label: 'PixelLab 接口',
    summary:
      '用 API Key 调 api.pixellab.ai/v2/balance，按「次」读取本周期剩余额度与 credits。',
    types: ['image'],
  },
]

export function syncSourcesFor(type: ProviderType) {
  return SYNC_SOURCES.filter((source) => source.types.includes(type))
}
