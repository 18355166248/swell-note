import { useEffect, useState, type ReactNode } from "react"
import { Check, FileText, Folder, FolderInput, FolderOpen, FolderPlus, PencilLine, Plus, Star, StarOff, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { VaultFolder } from "@/services/search/vault-folders"
import type { Note } from "@/types/note"

// 右键菜单挂在虚拟列表的行上，行随滚动回收；对话框因此不放在菜单里，
// 而是由工作区统一渲染这一份请求，避免行被卸载时对话框跟着消失。
export type ContextMenuRequest =
  | { folder: VaultFolder; kind: "folder-create" | "folder-delete" | "folder-rename" }
  | { kind: "note-delete" | "note-rename"; note: Note }

export type NoteContextActions = {
  disabled: boolean
  folders: VaultFolder[]
  onMove: (noteId: string, folderPath: string | null) => void
  onOpen: (note: Note) => void
  onRequest: (request: ContextMenuRequest) => void
  onToggleStar: (noteId: string) => void
}

export function NoteRowContextMenu({ actions, children, note }: {
  actions: NoteContextActions
  children: ReactNode
  note: Note
}) {
  const { disabled, folders, onMove, onOpen, onRequest, onToggleStar } = actions
  // 只读笔记与画布没有可写路径，重命名、移动、删除对它们都无从执行。
  const canManage = Boolean(note.remotePath && !note.readOnly && !disabled)
  const currentFolder = note.folder === "根目录" ? null : note.folder ?? null
  const moveTargets = folders.filter((folder) => folder.path !== "根目录")

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{note.title || "未命名笔记"}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpen(note)}><FileText />打开笔记</ContextMenuItem>
        <ContextMenuItem onSelect={() => onToggleStar(note.id)}>
          {note.starred ? <><StarOff />取消收藏</> : <><Star />收藏</>}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canManage} onSelect={() => onRequest({ kind: "note-rename", note })}>
          <PencilLine />重命名…
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canManage}><FolderInput />移动到文件夹</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            <ContextMenuItem disabled={currentFolder === null} onSelect={() => onMove(note.id, null)}>
              {currentFolder === null ? <Check /> : <Folder />}根目录
            </ContextMenuItem>
            {moveTargets.map((folder) => (
              <ContextMenuItem
                disabled={currentFolder === folder.path}
                key={folder.path}
                onSelect={() => onMove(note.id, folder.path)}
              >
                {currentFolder === folder.path ? <Check /> : <Folder />}{folder.path}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canManage}
          onSelect={() => onRequest({ kind: "note-delete", note })}
          variant="destructive"
        >
          <Trash2 />删除笔记
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export type FolderContextActions = {
  canCreateNote: boolean
  disabled: boolean
  mode: "local" | "webdav" | null
  onCreateNote: (folderPath: string) => void
  onOpen: (folderPath: string) => void
  onRequest: (request: ContextMenuRequest) => void
}

export function FolderRowContextMenu({ actions, children, folder }: {
  actions: FolderContextActions
  children: ReactNode
  folder: VaultFolder
}) {
  const { canCreateNote, disabled, mode, onCreateNote, onOpen, onRequest } = actions
  // 根目录是虚拟节点，重命名和删除都没有对应的真实目录。
  const canManage = Boolean(mode) && !disabled && folder.path !== "根目录"
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{folder.label}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpen(folder.path)}><FolderOpen />打开文件夹</ContextMenuItem>
        <ContextMenuItem disabled={!canCreateNote} onSelect={() => onCreateNote(folder.path)}>
          <Plus />在此新建笔记
        </ContextMenuItem>
        <ContextMenuItem disabled={!canManage} onSelect={() => onRequest({ folder, kind: "folder-create" })}>
          <FolderPlus />新建子文件夹…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canManage} onSelect={() => onRequest({ folder, kind: "folder-rename" })}>
          <PencilLine />重命名…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canManage}
          onSelect={() => onRequest({ folder, kind: "folder-delete" })}
          variant="destructive"
        >
          <Trash2 />删除文件夹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ContextMenuRequestDialog({ folderMode, onClose, onCreateFolder, onDeleteFolder, onDeleteNote, onRenameFolder, onRenameNote, request }: {
  folderMode: "local" | "webdav" | null
  onClose: () => void
  onCreateFolder: (name: string, parentFolder: string) => void
  onDeleteFolder: (folderPath: string) => void
  onDeleteNote: (noteId: string) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onRenameNote: (noteId: string, title: string) => void
  request: ContextMenuRequest | null
}) {
  const [value, setValue] = useState("")

  useEffect(() => {
    if (!request) return
    setValue(request.kind === "note-rename"
      ? request.note.title
      : request.kind === "folder-rename" ? request.folder.label : "")
  }, [request])

  if (!request) return null

  const trimmed = value.trim()
  const copy = describeContextRequest(request, folderMode)
  const submit = () => {
    onClose()
    switch (request.kind) {
      case "note-rename": onRenameNote(request.note.id, trimmed); break
      case "note-delete": onDeleteNote(request.note.id); break
      case "folder-rename": onRenameFolder(request.folder.path, trimmed); break
      case "folder-create": onCreateFolder(trimmed, request.folder.path); break
      default: onDeleteFolder(request.folder.path)
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose() }} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {copy.inputLabel ? (
          <Input
            aria-label={copy.inputLabel}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || !trimmed || trimmed === copy.currentName) return
              event.preventDefault()
              submit()
            }}
            placeholder={copy.placeholder}
            value={value}
          />
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="ghost">取消</Button>
          {copy.inputLabel ? (
            <Button disabled={!trimmed || trimmed === copy.currentName} onClick={submit}>{copy.confirmLabel}</Button>
          ) : (
            <Button onClick={submit} variant="destructive">{copy.confirmLabel}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function describeContextRequest(request: ContextMenuRequest, folderMode: "local" | "webdav" | null) {
  const cloud = folderMode === "webdav"
  switch (request.kind) {
    case "note-rename":
      return {
        confirmLabel: "确认重命名",
        currentName: request.note.title,
        description: "文件名会随标题一起更新。",
        inputLabel: "新笔记标题",
        placeholder: "例如：周会纪要",
        title: "重命名笔记",
      }
    case "note-delete":
      return {
        confirmLabel: "删除笔记",
        currentName: "",
        description: request.note.source === "webdav"
          ? "笔记会先在本机进入待同步删除，同步前可从回收站恢复。"
          : "笔记会移入 Swell Note 回收站，可在保留期内恢复。",
        inputLabel: "",
        placeholder: "",
        title: `删除“${request.note.title || "未命名笔记"}”`,
      }
    case "folder-create":
      return {
        confirmLabel: "创建文件夹",
        currentName: "",
        description: `将在“${request.folder.path}”下创建子文件夹。`,
        inputLabel: "文件夹名称",
        placeholder: "例如：项目资料",
        title: "新建子文件夹",
      }
    case "folder-rename":
      return {
        confirmLabel: "确认重命名",
        currentName: request.folder.label,
        description: cloud
          ? "该目录及所有子目录中的笔记会先在本机排队，点击同步后才移动坚果云文件。"
          : "将直接重命名本地 Vault 中的目录，并同步更新当前笔记索引。",
        inputLabel: "新文件夹名称",
        placeholder: "",
        title: "重命名文件夹",
      }
    default:
      return {
        confirmLabel: cloud ? "确认移入待删除" : "移入回收站",
        currentName: "",
        description: cloud
          ? "该目录中的笔记将进入待同步删除，可在同步前撤销。"
          : "文件夹及其中的全部文件会移动到 Swell Note 回收站，可在保留期内恢复。",
        inputLabel: "",
        placeholder: "",
        title: `删除“${request.folder.label}”`,
      }
  }
}
