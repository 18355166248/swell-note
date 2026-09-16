import { describe, expect, it } from "vitest"

import {
  createFolderRenamePlan,
  getFolderRenameTarget,
  isPendingDirectoryTree,
  remapWebDavNoteForDirectory,
  remapWebDavTrashForDirectory,
  replaceFolderPrefix,
  resolvePendingFolderMoveSourcePath,
} from "@/services/search/folder-rename"
import type { Note } from "@/types/note"

describe("folder rename", () => {
  it("重命名目录时保留子目录和文件名", () => {
    expect(getFolderRenameTarget("工作 / 项目 / 客户端", "工作 / 项目", "产品", "首页.md"))
      .toEqual({ folder: "工作 / 产品 / 客户端", relativePath: "工作/产品/客户端/首页.md" })
  })

  it("忽略不属于目标目录的笔记并清理非法字符", () => {
    expect(getFolderRenameTarget("生活", "工作", "产品", "首页.md")).toBeNull()
    expect(getFolderRenameTarget("工作", "工作", "产品/一期", "首页.md")?.folder).toBe("产品-一期")
  })

  it("不依赖笔记迁移空目录、空后代与待创建目录", () => {
    expect(createFolderRenamePlan({
      directories: ["工作", "工作 / 空目录", "工作 / 空目录 / 后代"],
      pendingDirectories: ["工作 / 空目录", "工作 / 空目录 / 后代"],
      requestedName: "归档",
      sourceFolder: "工作 / 空目录",
    })).toEqual({
      sourceFolder: "工作 / 空目录",
      targetFolder: "工作 / 归档",
      directories: ["工作", "工作 / 归档", "工作 / 归档 / 后代"],
      pendingDirectories: ["工作 / 归档", "工作 / 归档 / 后代"],
    })
  })

  it("拒绝与源子树外的同名目录碰撞", () => {
    expect(createFolderRenamePlan({
      directories: ["工作 / 旧名", "工作 / 新名"],
      pendingDirectories: [],
      requestedName: "新名",
      sourceFolder: "工作 / 旧名",
    })).toBeNull()
  })

  it("只替换完整目录前缀，不误伤相邻同名路径", () => {
    expect(replaceFolderPrefix("一级 / 二级 / 孙", "一级 / 二级", "一级 / 新二级")).toBe("一级 / 新二级 / 孙")
    expect(replaceFolderPrefix("一级 / 二级副本", "一级 / 二级", "一级 / 新二级")).toBe("一级 / 二级副本")
  })

  it("目录 MOVE 同步前按逆序解析连续重命名的真实远端读取路径", () => {
    expect(resolvePendingFolderMoveSourcePath("/Swell/C/a.md", [
      { sourceFolder: "A", targetFolder: "B" },
      { sourceFolder: "B", targetFolder: "C" },
    ], (folder) => `/Swell/${folder}`)).toBe("/Swell/A/a.md")
  })

  it("仅由目录生命周期决定是否排队远端 MOVE", () => {
    expect(isPendingDirectoryTree("新建 / 子目录", ["新建"])).toBe(true)
    expect(isPendingDirectoryTree("远端 / 子目录", ["别处"])).toBe(false)
  })

  it("目录重命名同步迁移删除墓碑、物理源路径和回收站恢复目标", () => {
    const tombstone: Note = {
      content: "",
      folder: "旧 / 子目录",
      id: "webdav:/Swell/旧/子目录/a.md",
      pendingOperation: "delete",
      preview: "",
      previousRemotePath: "/Swell/旧/子目录/a.md",
      remotePath: "/Swell/旧/子目录/a.md",
      source: "webdav",
      starred: false,
      syncStatus: "modified",
      title: "a",
      updatedAt: "待同步",
    }
    const options = {
      moveRemoteDirectory: true,
      sourceDirectory: "/Swell/旧",
      sourceFolder: "旧",
      targetDirectory: "/Swell/新",
      targetFolder: "新",
    }
    expect(remapWebDavNoteForDirectory(tombstone, options)).toMatchObject({
      folder: "新 / 子目录",
      id: "webdav:/Swell/新/子目录/a.md",
      previousRemotePath: "/Swell/新/子目录/a.md",
      remotePath: "/Swell/新/子目录/a.md",
    })
    expect(remapWebDavTrashForDirectory([{
      deletedAt: 1,
      folderPath: "旧 / 子目录",
      id: "trash-1",
      kind: "note",
      notes: [tombstone],
      originalPath: "/Swell/旧/子目录/a.md",
      source: "webdav",
    }], options)).toEqual([
      expect.objectContaining({
        folderPath: "新 / 子目录",
        notes: [expect.objectContaining({ remotePath: "/Swell/新/子目录/a.md" })],
        originalPath: "/Swell/新/子目录/a.md",
      }),
    ])
  })

  it("笔记逻辑上已移出目录时仍迁移落在目录内的 previousRemotePath", () => {
    const outgoing: Note = {
      baseContent: "BASE",
      content: "LOCAL",
      folder: "X",
      id: "webdav:/Swell/X/n.md",
      pendingOperation: "move",
      preview: "LOCAL",
      previousRemotePath: "/Swell/A/n.md",
      remotePath: "/Swell/X/n.md",
      revision: '"v1"',
      source: "webdav",
      starred: false,
      syncStatus: "modified",
      title: "n",
      updatedAt: "待同步",
    }
    expect(remapWebDavNoteForDirectory(outgoing, {
      moveRemoteDirectory: true,
      sourceDirectory: "/Swell/A",
      sourceFolder: "A",
      targetDirectory: "/Swell/B",
      targetFolder: "B",
    })).toMatchObject({
      folder: "X",
      id: "webdav:/Swell/X/n.md",
      previousRemotePath: "/Swell/B/n.md",
      remotePath: "/Swell/X/n.md",
    })
    expect(remapWebDavTrashForDirectory([{
      deletedAt: 1,
      folderPath: "X",
      id: "trash-outgoing",
      kind: "note",
      notes: [outgoing],
      originalPath: "/Swell/X/n.md",
      source: "webdav",
    }], {
      moveRemoteDirectory: true,
      sourceDirectory: "/Swell/A",
      sourceFolder: "A",
      targetDirectory: "/Swell/B",
      targetFolder: "B",
    })[0].notes[0]).toMatchObject({
      previousRemotePath: "/Swell/B/n.md",
      remotePath: "/Swell/X/n.md",
    })
  })
})
