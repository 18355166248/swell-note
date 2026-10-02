// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { afterEach, expect, it } from "vitest"
import { exportHistoryArchive, importHistoryArchive, listNoteVersions, saveNoteVersion } from "./note-history"
import { loadHistoryPolicy, saveHistoryPolicy } from "./history-policy"
afterEach(async () => {
  window.localStorage.clear()
  await new Promise<void>((resolve) => { const request = indexedDB.deleteDatabase("swell-note-history"); request.onsuccess = () => resolve() })
})
it("归档导入映射到当前笔记并去重，坏文件不部分写入", async () => {
  await saveNoteVersion({ cacheId: "a", noteId: "old", content: "甲", reason: "手动快照", title: "标题" }, 1000)
  await saveNoteVersion({ cacheId: "a", noteId: "old", content: "乙", reason: "手动快照", title: "标题" }, 2000)
  const raw = exportHistoryArchive(await listNoteVersions("a", "old"), "标题")
  expect(await importHistoryArchive("b", "current", raw)).toBe(2)
  expect(await importHistoryArchive("b", "current", raw)).toBe(0)
  const versions = await listNoteVersions("b", "current")
  expect(versions.map((version) => version.content)).toEqual(["乙", "甲"])
  expect(versions.every((version) => version.cacheId === "b" && version.noteId === "current")).toBe(true)
  const broken = JSON.parse(raw); broken.versions.push({ content: 1 })
  await expect(importHistoryArchive("b", "current", JSON.stringify(broken))).rejects.toThrow("无效版本")
  expect(await listNoteVersions("b", "current")).toEqual(versions)
})
it("并发快照仍按配置保留最新版本，间隔和保留设置过滤损坏值", async () => {
  saveHistoryPolicy({ limit: 30, intervalMinutes: 1 })
  await Promise.all(Array.from({ length: 40 }, (_, index) => saveNoteVersion({ cacheId: "v", noteId: "n", content: String(index), reason: "手动快照", title: "标题" }, index)))
  const versions = await listNoteVersions("v", "n")
  expect(versions).toHaveLength(30)
  expect(versions[0].content).toBe("39")
  expect(versions[29].content).toBe("10")
  window.localStorage.setItem("swell-note:history-policy:v1", "null")
  expect(loadHistoryPolicy()).toEqual({ limit: 30, intervalMinutes: 5 })
})
