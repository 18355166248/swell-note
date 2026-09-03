import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * 把每次渲染都会重建的回调包成引用稳定的版本。
 *
 * 笔记列表这类长列表要靠 memo 跳过重渲染，而 memo 会被「每次渲染新建的函数」直接击穿。
 * 这里始终返回同一个函数，内部再转发到最新一次渲染拿到的实现，
 * 既保住引用稳定，也不会读到过期的闭包状态。
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const callbackRef = useRef(callback)
  // 用 layout 阶段同步，确保同一帧内触发的事件已经读到这次渲染的实现。
  useLayoutEffect(() => {
    callbackRef.current = callback
  })
  return useCallback((...args: Args) => callbackRef.current(...args), [])
}

/** 与 useStableCallback 相同，但允许上游回调缺省，并在缺省时返回 undefined 以便下游关闭相关交互。 */
export function useOptionalStableCallback<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  })
  const stable = useCallback((...args: Args) => callbackRef.current?.(...args), [])
  return callback ? stable : undefined
}
