import { useEffect, useState } from "react"
import { Check, ChevronRight, FileText, Folder, FolderOpen, PencilLine, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { VaultFolder } from "@/services/search/vault-folders"
import type { Note } from "@/types/note"

export function MobileFolderActionSheet({ disabled, folder, mode, onClose, onDelete, onOpen, onRename }: {
  disabled: boolean
  folder: VaultFolder | null
  mode: "local" | "webdav" | null
  onClose: () => void
  onDelete: (folderPath: string) => void
  onOpen: (folderPath: string) => void
  onRename: (folderPath: string, nextName: string) => void
}) {
  const [view, setView] = useState<"delete" | "menu" | "rename">("menu")
  const [name, setName] = useState("")

  useEffect(() => {
    setView("menu")
    setName(folder?.label ?? "")
  }, [folder])

  if (!folder || !mode) return null

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose() }} open>
      <DialogContent className="mobile-action-sheet" placement="bottom">
        <DialogHeader>
          <DialogTitle>{view === "menu" ? folder.label : view === "rename" ? "重命名文件夹" : `删除“${folder.label}”`}</DialogTitle>
          <DialogDescription>
            {view === "menu"
              ? `${folder.count} 篇笔记 · 长按快捷操作`
              : view === "rename"
                ? mode === "local" ? "将重命名本地 Vault 目录。" : "重命名会先保存在本机，点击同步后更新坚果云。"
                : mode === "local" ? "文件夹及其中内容会移入回收站。" : "目录中的笔记会进入待同步删除。"}
          </DialogDescription>
        </DialogHeader>
        {view === "menu" ? (
          <div className="mobile-action-list">
            <button onClick={() => onOpen(folder.path)} type="button"><FolderOpen /><span>打开文件夹</span><ChevronRight /></button>
            <button disabled={disabled} onClick={() => setView("rename")} type="button"><PencilLine /><span>重命名</span><ChevronRight /></button>
            <button className="mobile-action-destructive" disabled={disabled} onClick={() => setView("delete")} type="button"><Trash2 /><span>删除文件夹</span><ChevronRight /></button>
          </div>
        ) : view === "rename" ? (
          <Input autoFocus aria-label="新文件夹名称" onChange={(event) => setName(event.target.value)} value={name} />
        ) : null}
        {view !== "menu" ? (
          <DialogFooter>
            <Button onClick={() => setView("menu")} variant="ghost">返回</Button>
            {view === "rename" ? (
              <Button disabled={!name.trim() || name.trim() === folder.label} onClick={() => { onClose(); onRename(folder.path, name) }}>保存</Button>
            ) : (
              <Button disabled={disabled} onClick={() => { onClose(); onDelete(folder.path) }} variant="destructive">确认删除</Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function MobileNoteActionSheet({ disabled, folders, note, onClose, onDelete, onMove, onOpen, onRename }: {
  disabled: boolean
  folders: VaultFolder[]
  note: Note | null
  onClose: () => void
  onDelete: (noteId: string) => void
  onMove: (noteId: string, folderPath: string | null) => void
  onOpen: (note: Note) => void
  onRename: (noteId: string, title: string) => void
}) {
  const [view, setView] = useState<"delete" | "menu" | "move" | "rename">("menu")
  const [title, setTitle] = useState("")

  useEffect(() => {
    setView("menu")
    setTitle(note?.title ?? "")
  }, [note])

  if (!note) return null
  const canManage = Boolean(note.remotePath && !note.readOnly && !disabled)
  const currentFolder = note.folder === "根目录" ? null : note.folder ?? null
  const moveTargets = folders.filter((folder) => folder.path !== "根目录")

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose() }} open>
      <DialogContent className="mobile-action-sheet" placement="bottom">
        <DialogHeader>
          <DialogTitle>{view === "menu" ? note.title || "未命名笔记" : view === "rename" ? "重命名笔记" : view === "move" ? "移动到文件夹" : "删除笔记"}</DialogTitle>
          <DialogDescription>
            {view === "menu"
              ? `${note.updatedAt} · ${note.folder ?? "根目录"}`
              : view === "rename" ? "文件名会随标题一起更新。"
                : view === "move" ? "选择目标目录，修改会先保存在本机。"
                  : note.source === "webdav" ? "笔记将进入待同步删除，可从回收站恢复。" : "笔记将移入回收站。"}
          </DialogDescription>
        </DialogHeader>
        {view === "menu" ? (
          <div className="mobile-action-list">
            <button onClick={() => onOpen(note)} type="button"><FileText /><span>打开笔记</span><ChevronRight /></button>
            <button disabled={!canManage} onClick={() => setView("rename")} type="button"><PencilLine /><span>重命名</span><ChevronRight /></button>
            <button disabled={!canManage} onClick={() => setView("move")} type="button"><FolderOpen /><span>移动到文件夹</span><ChevronRight /></button>
            <button className="mobile-action-destructive" disabled={!canManage} onClick={() => setView("delete")} type="button"><Trash2 /><span>删除笔记</span><ChevronRight /></button>
          </div>
        ) : view === "rename" ? (
          <Input autoFocus aria-label="新笔记标题" onChange={(event) => setTitle(event.target.value)} value={title} />
        ) : view === "move" ? (
          <div className="mobile-move-targets">
            <button disabled={currentFolder === null} onClick={() => { onClose(); onMove(note.id, null) }} type="button"><Folder /><span>根目录</span>{currentFolder === null ? <Check /> : <ChevronRight />}</button>
            {moveTargets.map((folder) => (
              <button disabled={currentFolder === folder.path} key={folder.path} onClick={() => { onClose(); onMove(note.id, folder.path) }} type="button">
                <Folder /><span>{folder.path}</span>{currentFolder === folder.path ? <Check /> : <ChevronRight />}
              </button>
            ))}
          </div>
        ) : null}
        {view === "rename" || view === "delete" ? (
          <DialogFooter>
            <Button onClick={() => setView("menu")} variant="ghost">返回</Button>
            {view === "rename" ? (
              <Button disabled={!title.trim() || title.trim() === note.title} onClick={() => { onClose(); onRename(note.id, title) }}>保存</Button>
            ) : (
              <Button disabled={!canManage} onClick={() => { onClose(); onDelete(note.id) }} variant="destructive">确认删除</Button>
            )}
          </DialogFooter>
        ) : view === "move" ? <DialogFooter><Button onClick={() => setView("menu")} variant="ghost">返回</Button></DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}
