import { LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FolderOrderConflict } from "@/services/cache/folder-order-sync-store"

const PREVIEW_LIMIT = 6

function OrderPreview({ entries, emptyLabel }: { emptyLabel: string; entries: string[] }) {
  if (entries.length === 0) return <p className="folder-order-conflict-empty">{emptyLabel}</p>
  const visible = entries.slice(0, PREVIEW_LIMIT)
  return (
    <ol className="folder-order-conflict-list">
      {visible.map((path) => <li key={path}>{path}</li>)}
      {entries.length > PREVIEW_LIMIT ? <li>… 共 {entries.length} 项</li> : null}
    </ol>
  )
}

// 排序冲突选择：两端候选都来自工作副本快照；关闭只保留冲突，不触发重试，避免循环弹窗。
export function FolderOrderConflictDialog({
  conflict,
  onDismiss,
  onResolve,
  open,
  resolving,
}: {
  conflict: FolderOrderConflict | null
  onDismiss: () => void
  onResolve: (choice: "local" | "remote") => void
  open: boolean
  resolving: boolean
}) {
  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen && !resolving) onDismiss() }} open={open && conflict !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>文件夹排序存在冲突</DialogTitle>
          <DialogDescription>
            这台设备与云端的文件夹顺序不一致。选择保留哪一份；稍后选择不会丢失任何一边，冲突会保留到下次处理。
          </DialogDescription>
        </DialogHeader>
        {conflict ? (
          <div className="folder-order-conflict-columns">
            <div className="folder-order-conflict-column">
              <h3>本机顺序</h3>
              <OrderPreview entries={conflict.localOrder} emptyLabel="（本机为自然顺序）" />
            </div>
            <div className="folder-order-conflict-column">
              <h3>云端顺序</h3>
              {conflict.remoteExists
                ? <OrderPreview entries={conflict.remoteOrder} emptyLabel="（云端为自然顺序）" />
                : <p className="folder-order-conflict-empty">云端配置已被删除；使用云端将恢复自然顺序。</p>}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button disabled={resolving} onClick={onDismiss} type="button" variant="outline">稍后选择</Button>
          <Button disabled={resolving} onClick={() => onResolve("remote")} type="button" variant="outline">
            {resolving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            使用云端
          </Button>
          <Button disabled={resolving} onClick={() => onResolve("local")} type="button">
            {resolving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            使用本机
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
