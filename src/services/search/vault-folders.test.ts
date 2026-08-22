import { describe, expect, it } from "vitest"

import { buildVaultFolders, noteBelongsToFolder } from "./vault-folders"
import type { Note } from "@/types/note"

const notes = [
  { id: "1", folder: "工作 / 项目", title: "A" },
  { id: "2", folder: "工作 / 项目", title: "B" },
  { id: "3", folder: "工作 / 会议", title: "C" },
] as Note[]

describe("vault folders", () => {
  it("按真实路径生成层级和递归计数", () => {
    expect(buildVaultFolders(notes)).toEqual([
      expect.objectContaining({ count: 3, depth: 0, label: "工作", path: "工作" }),
      expect.objectContaining({ count: 2, depth: 1, label: "项目", path: "工作 / 项目" }),
      expect.objectContaining({ count: 1, depth: 1, label: "会议", path: "工作 / 会议" }),
    ])
  })

  it("选择父目录时包含所有后代笔记", () => {
    expect(notes.filter((note) => noteBelongsToFolder(note, "工作"))).toHaveLength(3)
    expect(notes.filter((note) => noteBelongsToFolder(note, "工作 / 项目"))).toHaveLength(2)
  })
})
