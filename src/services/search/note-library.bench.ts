import { bench, describe } from "vitest"

import { buildVaultFolders, noteBelongsToFolder } from "./vault-folders"
import { sortNotes } from "./note-sort"
import type { Note } from "@/types/note"

function createNotes(count: number): Note[] {
  return Array.from({ length: count }, (_, index) => {
    const folder = `项目-${index % 40} / 阶段-${index % 8}`
    return {
      content: "",
      contentLoaded: false,
      folder,
      id: `webdav:/Swell/${folder}/笔记-${index}.md`,
      modifiedAt: 1_800_000_000_000 - index * 1_000,
      preview: `第 ${index} 篇笔记摘要，包含产品、研发和同步信息`,
      readOnly: true,
      remotePath: `/Swell/${folder}/笔记-${index}.md`,
      searchText: `笔记 ${index} 产品 研发 同步`,
      source: "webdav",
      starred: index % 17 === 0,
      title: `笔记-${index}`,
      updatedAt: "刚刚",
    }
  })
}

function exerciseLibrary(notes: Note[]) {
  const folders = buildVaultFolders(notes, [])
  const selected = notes.filter((note) => noteBelongsToFolder(note, "项目-12"))
  const searched = notes.filter((note) => `${note.title} ${note.preview} ${note.searchText ?? ""}`.includes("研发"))
  const sorted = sortNotes(searched, "updated-desc")
  return folders.length + selected.length + sorted.length
}

describe("笔记库列表与搜索性能基线", () => {
  const currentLimit = createNotes(2_000)
  const futureScale = createNotes(10_000)

  bench("2,000 篇：建目录、筛选与排序", () => {
    exerciseLibrary(currentLimit)
  })

  bench("10,000 篇：建目录、筛选与排序", () => {
    exerciseLibrary(futureScale)
  })
})
