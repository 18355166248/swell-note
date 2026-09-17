import { Crepe, CrepeFeature } from "@milkdown/crepe"
import { editorViewCtx } from "@milkdown/kit/core"
import { redo, undo } from "@milkdown/kit/prose/history"
import { memo, useEffect, useRef, useState } from "react"

import "@milkdown/crepe/theme/common/style.css"
import "@milkdown/crepe/theme/frame.css"

type MilkdownLabProps = {
  initialMarkdown: string
  onChange: (markdown: string, latencyMs: number | null) => void
  onError: (message: string) => void
  onReady: (markdown: string, readyMs: number) => void
  startedAt: number
}

export const MilkdownLab = memo(function MilkdownLab({ initialMarkdown, onChange, onError, onReady, startedAt }: MilkdownLabProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const pendingInputAt = useRef<number | null>(null)
  const callbacks = useRef({ onChange, onError, onReady })
  const [ready, setReady] = useState(false)
  callbacks.current = { onChange, onError, onReady }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const crepe = new Crepe({
      root: host,
      defaultValue: initialMarkdown,
      features: {
        [CrepeFeature.BlockEdit]: true,
      },
      featureConfigs: {
        [CrepeFeature.BlockEdit]: {
          // 实验页必须为 66px 宽的块手柄预留左侧轨道，否则 Floating UI 会翻转到右侧并被卡片裁掉。
          blockHandle: { getOffset: () => 8 },
          textGroup: {
            label: "文本",
            text: { label: "正文" },
            h1: { label: "一级标题" },
            h2: { label: "二级标题" },
            h3: { label: "三级标题" },
            h4: { label: "四级标题" },
            h5: { label: "五级标题" },
            h6: { label: "六级标题" },
            quote: { label: "引用" },
            divider: { label: "分割线" },
          },
          listGroup: {
            label: "列表",
            bulletList: { label: "无序列表" },
            orderedList: { label: "有序列表" },
            taskList: { label: "任务列表" },
          },
          advancedGroup: {
            label: "高级",
            image: { label: "图片" },
            codeBlock: { label: "代码块" },
            table: { label: "表格" },
            math: { label: "公式" },
          },
        },
      },
    })
    crepeRef.current = crepe
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (disposed) return
        const latency = pendingInputAt.current === null ? null : performance.now() - pendingInputAt.current
        pendingInputAt.current = null
        callbacks.current.onChange(markdown, latency)
      })
    })
    void crepe.create().then(() => {
      if (disposed) return
      setReady(true)
      callbacks.current.onReady(crepe.getMarkdown(), performance.now() - startedAt)
    }).catch((error: unknown) => {
      if (!disposed) callbacks.current.onError(error instanceof Error ? error.message : "Milkdown 初始化失败")
    })
    return () => {
      disposed = true
      setReady(false)
      if (crepeRef.current === crepe) crepeRef.current = null
      void crepe.destroy()
    }
  }, [initialMarkdown, startedAt])

  const runHistory = (forward: boolean) => {
    const crepe = crepeRef.current
    if (!crepe) return
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const command = forward ? redo : undo
      command(view.state, view.dispatch, view)
      view.focus()
    })
  }

  return (
    <div
      className="editor-lab-editor-body editor-lab-milkdown"
      onBeforeInputCapture={() => { pendingInputAt.current = performance.now() }}
      onPasteCapture={() => { pendingInputAt.current = performance.now() }}
    >
      <div className="editor-lab-inline-actions" aria-label="Milkdown 历史操作">
        <button disabled={!ready} onClick={() => runHistory(false)} type="button">撤销</button>
        <button disabled={!ready} onClick={() => runHistory(true)} type="button">重做</button>
      </div>
      <p className="editor-lab-milkdown-hint">悬停或点入段落：左侧 ＋ 插入块，⠿ 拖动排序；输入 / 也可唤起菜单</p>
      <div className="editor-lab-milkdown-scroll">
        <div ref={hostRef} />
      </div>
    </div>
  )
})
