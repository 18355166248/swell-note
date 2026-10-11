import { Minus, Plus, Table2 } from "lucide-react"
import { useLayoutEffect, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { TABLE_DEFAULT_SIZE, TABLE_LIMITS } from "@/components/editor/table-template"

// 记住上一次选的尺寸：连续插入同规格表格时不必每次重新调。
let lastSize: { rows: number; cols: number } = { ...TABLE_DEFAULT_SIZE }

export function TableSizePicker({ anchorRef, panelRef, onCancel, onConfirm }: {
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  onCancel: () => void
  onConfirm: (rows: number, cols: number) => void
}) {
  const [size, setSize] = useState(lastSize)
  const update = (patch: Partial<typeof size>) => setSize((current) => ({ ...current, ...patch }))
  const previewRows = Math.min(size.rows, 6)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = anchorRef.current
    if (!panel || !anchor) return
    const previousFocus = document.activeElement
    // 浮层挂到 body 避开编辑区裁切；按实际可视区定位，键盘或横竖屏变化后仍能操作。
    const position = () => {
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 8
      const top = (viewport?.offsetTop ?? 0) + 8
      const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 16)
      const height = Math.max(0, (viewport?.height ?? window.innerHeight) - 16)
      panel.style.width = `${Math.min(320, width)}px`
      panel.style.maxHeight = `${height}px`
      // 键盘占用大部分屏幕时收起装饰预览，把空间留给尺寸控件和确认按钮。
      panel.dataset.compact = height < 300 ? "true" : "false"
      const rect = anchor.getBoundingClientRect()
      const panelHeight = panel.getBoundingClientRect().height
      const below = rect.bottom + 8
      const above = rect.top - panelHeight - 8
      const preferAbove = anchor.closest('[data-mobile="true"]') !== null
      const y = preferAbove ? (above >= top ? above : below) : (below + panelHeight <= top + height ? below : above)
      panel.style.left = `${Math.max(left, Math.min(rect.left, left + width - panel.offsetWidth))}px`
      panel.style.top = `${Math.max(top, Math.min(y, top + height - panelHeight))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(panel)
    observer.observe(anchor)
    window.addEventListener("resize", position)
    window.addEventListener("scroll", position, true)
    window.visualViewport?.addEventListener("resize", position)
    window.visualViewport?.addEventListener("scroll", position)
    return () => {
      // 鼠标/触屏不抢焦点；键盘进入弹窗后取消时回到原控件，避免焦点落到 body。
      // 确认插入已聚焦新表格时不回退，防止覆盖编辑器主动设置的单元格焦点。
      if (panel.contains(document.activeElement) && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
      observer.disconnect()
      window.removeEventListener("resize", position)
      window.removeEventListener("scroll", position, true)
      window.visualViewport?.removeEventListener("resize", position)
      window.visualViewport?.removeEventListener("scroll", position)
    }
  }, [anchorRef, panelRef])

  return createPortal(
    <div ref={panelRef} aria-label="插入表格" className="table-picker-popover" role="dialog">
      <div className="table-picker-header">
        <div className="table-picker-title"><Table2 aria-hidden /><strong>插入表格</strong></div>
        <p>首行为表头，单元格留空</p>
      </div>
      <div className="table-picker-body">
        <div aria-label="常用尺寸" className="table-picker-presets" role="group">
          {[2, 3, 4].map((count) => (
            <button
              aria-label={`${count} 行 × ${count} 列`}
              aria-pressed={size.rows === count && size.cols === count}
              key={count}
              onClick={() => setSize({ rows: count, cols: count })}
              onPointerDown={(event) => event.preventDefault()}
              type="button"
            >{count} × {count}</button>
          ))}
        </div>
        <div className="table-picker-dimensions">
          <Stepper
            label="行数"
            hint="含表头"
            max={TABLE_LIMITS.maxRows}
            min={TABLE_LIMITS.minRows}
            onChange={(rows) => update({ rows })}
            value={size.rows}
          />
          <Stepper
            label="列数"
            max={TABLE_LIMITS.maxCols}
            min={TABLE_LIMITS.minCols}
            onChange={(cols) => update({ cols })}
            value={size.cols}
          />
        </div>
        <div className="table-picker-preview-section">
          <div className="table-picker-preview-label"><span>{size.rows} 行 × {size.cols} 列</span><span>{size.rows > previewRows ? `预览前 ${previewRows} 行` : "表格预览"}</span></div>
          {/* 预览只展示前六行且高度固定，调整行数不会把浮层和确认按钮推来推去。 */}
          <div aria-hidden className="table-picker-preview" style={{ gridTemplateColumns: `repeat(${size.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${previewRows}, minmax(0, 1fr))` }}>
            {Array.from({ length: previewRows * size.cols }, (_, index) => (
              <span data-header={index < size.cols || undefined} key={index} />
            ))}
          </div>
        </div>
      </div>
      <div className="table-picker-actions">
        <button onClick={onCancel} onPointerDown={(event) => event.preventDefault()} type="button">取消</button>
        <button data-primary="true" onClick={() => { lastSize = size; onConfirm(size.rows, size.cols) }} onPointerDown={(event) => event.preventDefault()} type="button">
          插入 {size.rows} × {size.cols}
        </button>
      </div>
    </div>,
    document.body,
  )
}

function Stepper({ label, hint, max, min, onChange, value }: {
  label: string
  hint?: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}) {
  const accessibleLabel = hint ? `${label}（${hint}）` : label
  return (
    <div className="table-picker-row">
      <div className="table-picker-dimension-label"><span>{label}</span>{hint ? <small>{hint}</small> : null}</div>
      <div className="table-picker-stepper">
        <button aria-label={`减少${accessibleLabel}`} disabled={value <= min} onClick={() => onChange(value - 1)} onPointerDown={(event) => event.preventDefault()} type="button"><Minus /></button>
        <output aria-label={accessibleLabel}>{value}</output>
        <button aria-label={`增加${accessibleLabel}`} disabled={value >= max} onClick={() => onChange(value + 1)} onPointerDown={(event) => event.preventDefault()} type="button"><Plus /></button>
      </div>
    </div>
  )
}
