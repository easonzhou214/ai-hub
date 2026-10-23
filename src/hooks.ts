import { useEffect, useRef, type RefObject } from 'react'

/**
 * 弹层通用行为。
 *
 * 项目里有 5 处弹层各自复制了「document 上监听 Esc」和「延时聚焦」两段逻辑，
 * 而且回调多来自父组件的内联箭头函数——直接放进依赖会让 effect 在父组件每次
 * 渲染时重跑，既重复绑定监听，也会把焦点从用户正在输入的字段抢走。这里统一
 * 用 ref 持有回调，依赖只保留 active。
 */

export function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape)
  handlerRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handlerRef.current()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [active])
}

export function useInitialFocus<T extends HTMLElement>(
  active: boolean,
  ref: RefObject<T | null>,
  delayMs = 60,
) {
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => ref.current?.focus(), delayMs)
    return () => window.clearTimeout(timer)
  }, [active, delayMs, ref])
}
