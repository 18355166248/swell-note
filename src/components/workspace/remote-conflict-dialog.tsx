import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { VaultFileEntry } from "@/services/vault/vault-adapter"

export function RemoteConflictDialog({ sourcePath, candidates, onChoose, onDismiss, resolving }: {
  sourcePath?: string
  candidates: VaultFileEntry[]
  onChoose: (file: VaultFileEntry) => void
  onDismiss: () => void
  resolving: boolean
}) {
  return <Dialog open={Boolean(sourcePath)} onOpenChange={(open) => { if (!open && !resolving) onDismiss() }}>
    <DialogContent showCloseButton={!resolving}>
      <DialogHeader>
        <DialogTitle>原云端路径已不存在</DialogTitle>
        <DialogDescription className="break-all">
          原路径：{sourcePath}。以下同名文件可能位于其他文件夹，请确认后选择。本地正文会先保存在目标笔记的版本历史中；采用云端不会上传正文。
        </DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[45vh] gap-2 overflow-auto">
        {candidates.map((file) => <Button className="h-auto whitespace-normal break-all text-left" disabled={resolving} key={file.path} onClick={() => onChoose(file)} variant="outline">
          采用云端文件：{file.path}
        </Button>)}
      </div>
      <Button disabled={resolving} onClick={onDismiss} variant="ghost">暂不处理，保留本地版本</Button>
    </DialogContent>
  </Dialog>
}
