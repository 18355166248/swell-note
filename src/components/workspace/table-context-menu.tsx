import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Eraser, Trash2 } from "lucide-react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { tableWidgetApiFor, type TableMenuTarget, type TableWidgetApi, type TableWidgetMenuState } from "@/components/editor/table-widget-registry"

type Snapshot = {
  api: TableWidgetApi
  state: TableWidgetMenuState
}

// 表格单元格（非编辑态）的专属菜单：插入/删除行列、清空、删表。
// 编辑中的 textarea 仍走 TextContextMenu（那里附带同一组行列操作），两边不会同时出现。
export function TableContextMenu() {
  const trigger = useRef<HTMLSpanElement>(null)
  const target = useRef<Snapshot | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null
      if (!element || element === trigger.current || element.closest('[data-slot="context-menu-content"]')) return
      // 单元格输入框的右键交给 TextContextMenu，保留文字级复制/剪切/粘贴与焦点保护。
      if (element.closest(".cm-md-table-cell-input")) return
      const found = tableWidgetApiFor(element)
      if (!found) return
      // 被点的单元格（表头 row = -1）；点在表格工具栏等空白处时不改目标。
      const cellElement = element.closest<HTMLElement>("th, td")
      const cell: TableMenuTarget | null = cellElement && found.wrapper.contains(cellElement)
        ? { column: Number(cellElement.dataset.columnIndex), row: Number(cellElement.dataset.rowIndex) }
        : null
      const tableFrom = found.wrapper.dataset.tableFrom
      event.preventDefault()
      event.stopPropagation()
      // 右键发生在单元格编辑途中：先把未提交的输入写回，结构操作才不会丢掉正在编辑的文字。
      found.api.commitActiveEdit()
      // 提交可能重建表格 DOM，经 data-table-from 找回当前存活的 wrapper 与接口。
      const liveWrapper = tableFrom ? document.querySelector<HTMLElement>(`.cm-md-table-wrap[data-table-from="${tableFrom}"]`) : null
      const live = (liveWrapper && tableWidgetApiFor(liveWrapper)) ?? found
      if (cell && Number.isInteger(cell.row) && Number.isInteger(cell.column)) {
        // 右键已有选区内保留选区；选区外则把操作目标改到被点的单元格。
        live.api.retarget(cell)
      }
      const next = { api: live.api, state: live.api.getMenuState() }
      target.current = next
      setSnapshot(next)
      trigger.current?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }))
    }
    document.addEventListener("contextmenu", open, true)
    return () => document.removeEventListener("contextmenu", open, true)
  }, [])

  const run = (action: (api: TableWidgetApi) => void) => {
    const saved = target.current
    if (!saved) return
    action(saved.api)
  }
  const state = snapshot?.state
  const rangeSuffix = state?.hasRangeSelection ? "选中区域" : null

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger ref={trigger} className="fixed size-0 pointer-events-none" aria-hidden />
      <ContextMenuContent onCloseAutoFocus={(event) => {
        // 隐藏触发器不接收焦点；编辑中的单元格已在打开前提交，焦点留在正文即可。
        event.preventDefault()
      }}>
        <ContextMenuItem onSelect={() => run((api) => void api.copySelection())}><Copy />{rangeSuffix ? "复制选中区域" : "复制"}</ContextMenuItem>
        {state && !state.readOnly ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!state.canInsertRowAbove} onSelect={() => run((api) => api.insertRow("above"))}><ArrowUp />在上方插入行</ContextMenuItem>
            <ContextMenuItem onSelect={() => run((api) => api.insertRow("below"))}><ArrowDown />在下方插入行</ContextMenuItem>
            <ContextMenuItem onSelect={() => run((api) => api.insertColumn("left"))}><ArrowLeft />在左侧插入列</ContextMenuItem>
            <ContextMenuItem onSelect={() => run((api) => api.insertColumn("right"))}><ArrowRight />在右侧插入列</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!state.canClear} onSelect={() => run((api) => api.clearContents())}><Eraser />{rangeSuffix ? "清空选中区域" : "清空内容"}</ContextMenuItem>
            <ContextMenuItem disabled={!state.canDeleteRow} variant="destructive" onSelect={() => run((api) => api.deleteRows())}><Trash2 />{rangeSuffix ? "删除选中行" : "删除行"}</ContextMenuItem>
            <ContextMenuItem disabled={!state.canDeleteColumn} variant="destructive" onSelect={() => run((api) => api.deleteColumns())}><Trash2 />{rangeSuffix ? "删除选中列" : "删除列"}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => run((api) => api.deleteWholeTable())}><Trash2 />删除表格</ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
