import { describe, expect, it } from "vitest"
import { createNoteReadingPositions, readingPositionKey, resolveReadingAnchor, type NoteReadingPosition } from "./note-reading-position"

const position: NoteReadingPosition = { anchor: { line: 3, text: "原段落", fraction: .4 }, scrollTop: 500 }
function storage() {
  let value: string | null = null
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
}

describe("note reading position", () => {
  it("重启后恢复，缓存库和笔记分别隔离", () => {
    const disk = storage(), memory = createNoteReadingPositions(() => disk)
    const key = readingPositionKey("a", "note")
    memory.set(key, position)
    memory.flush()
    const restarted = createNoteReadingPositions(() => disk)
    expect(restarted.get(key)).toEqual(position)
    expect(restarted.get(readingPositionKey("b", "note"))).toBeNull()
    expect(restarted.get(readingPositionKey("a", "other"))).toBeNull()
    expect(readingPositionKey("a:b", "c")).not.toBe(readingPositionKey("a", "b:c"))
  })

  it("重命名把位置迁到新文件，覆盖新路径的旧记录", () => {
    const disk = storage(), memory = createNoteReadingPositions(() => disk)
    memory.set("old", position)
    memory.set("new", { anchor: null, scrollTop: 0 })
    memory.move("old", "new")
    memory.flush()
    const restarted = createNoteReadingPositions(() => disk)
    expect(restarted.get("old")).toBeNull()
    expect(restarted.get("new")).toEqual(position)
  })

  it("容量淘汰最久未访问项，损坏数据和非有限数字不能进入记录", () => {
    const disk = storage()
    disk.setItem("", JSON.stringify([["invalid", { anchor: { line: 0, text: "", fraction: 2 }, scrollTop: 0 }]]))
    const memory = createNoteReadingPositions(() => disk, 2)
    expect(memory.get("invalid")).toBeNull()
    memory.set("a", position)
    memory.set("b", position)
    memory.get("a")
    memory.set("c", position)
    memory.set("invalid", { anchor: null, scrollTop: Infinity })
    expect(memory.get("b")).toBeNull()
    expect(memory.get("a")).toEqual(position)
    expect(memory.get("invalid")).toBeNull()
  })

  it("存储读写拒绝时仍能在本次会话恢复", () => {
    const memory = createNoteReadingPositions(() => { throw new Error("storage unavailable") })
    expect(memory.get("missing")).toBeNull()
    memory.set("a", position)
    expect(() => memory.flush()).not.toThrow()
    expect(memory.get("a")).toEqual(position)
  })

  it("前文增删后找到原段，重复段落取距离最近的位置", () => {
    const anchor = position.anchor!
    expect(resolveReadingAnchor(anchor, "新行\n第一行\n第二行\n原段落\n尾行")).toEqual({ ...anchor, line: 4 })
    expect(resolveReadingAnchor(anchor, "原段落\n第二行\n第三行\n原段落")).toEqual({ ...anchor, line: 4 })
  })

  it("原段删除和短文替换时退到有效行首，空行不跳到任意空白", () => {
    expect(resolveReadingAnchor(position.anchor!, "新文")).toEqual({ line: 1, text: "新文", fraction: 0 })
    expect(resolveReadingAnchor({ line: 3, text: "", fraction: .4 }, "\n内容\n新段\n\n末尾")).toEqual({ line: 3, text: "新段", fraction: 0 })
  })
})
