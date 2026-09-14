// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"

import {
  applyFolderOrder,
  applyFolderOrderToTree,
  loadFolderOrder,
  moveFolderOrderPath,
  reorderTopLevelPaths,
  saveFolderOrder,
} from "./folder-order-preferences"

describe("folder order preferences", () => {
  beforeEach(() => window.localStorage.clear())

  it("stores independent folder orders for each library", () => {
    saveFolderOrder("vault-a", ["AI", "Daily"])
    saveFolderOrder("vault-b", ["Person"])

    expect(loadFolderOrder("vault-a")).toEqual(["AI", "Daily"])
    expect(loadFolderOrder("vault-b")).toEqual(["Person"])
  })

  it("keeps newly discovered folders after the saved paths", () => {
    const folders = [{ path: "AI" }, { path: "Daily" }, { path: "Person" }]

    expect(applyFolderOrder(folders, ["Daily", "AI"])).toEqual([
      { path: "Daily" },
      { path: "AI" },
      { path: "Person" },
    ])
  })

  it("falls back safely when storage is invalid", () => {
    window.localStorage.setItem("swell-note:folder-order:v1", "{invalid")
    expect(loadFolderOrder("vault-a")).toEqual([])
  })
})

type TestFolder = { depth: number; path: string }

function folder(path: string): TestFolder {
  return { depth: path.split(" / ").length - 1, path }
}

function pathsOf(folders: TestFolder[]) {
  return folders.map((entry) => entry.path)
}

describe("applyFolderOrderToTree", () => {
  const tree = [
    folder("根目录"),
    folder("Alpha"),
    folder("Alpha / 子一"),
    folder("Alpha / 子一 / 孙"),
    folder("Alpha / 子二"),
    folder("Beta"),
    folder("Beta / 子三"),
    folder("Gamma"),
  ]

  it("顶层重排后子树整体跟随，子目录内部顺序不变", () => {
    const ordered = applyFolderOrderToTree(tree, ["Beta", "Alpha", "Gamma"])

    expect(pathsOf(ordered)).toEqual([
      "根目录",
      "Beta",
      "Beta / 子三",
      "Alpha",
      "Alpha / 子一",
      "Alpha / 子一 / 孙",
      "Alpha / 子二",
      "Gamma",
    ])
  })

  it("系统根目录固定在最前，偏好中的根目录条目会被忽略", () => {
    const ordered = applyFolderOrderToTree(tree, ["Gamma", "根目录", "Beta"])

    expect(pathsOf(ordered)).toEqual([
      "根目录",
      "Gamma",
      "Beta",
      "Beta / 子三",
      "Alpha",
      "Alpha / 子一",
      "Alpha / 子一 / 孙",
      "Alpha / 子二",
    ])
  })

  it("新增目录追加在已排序目录之后，多个新目录保持原始相对顺序", () => {
    const ordered = applyFolderOrderToTree(tree, ["Gamma"])

    expect(pathsOf(ordered)).toEqual([
      "根目录",
      "Gamma",
      "Alpha",
      "Alpha / 子一",
      "Alpha / 子一 / 孙",
      "Alpha / 子二",
      "Beta",
      "Beta / 子三",
    ])
  })

  it("已删除目录只留在偏好里，不会产出幽灵项", () => {
    const ordered = applyFolderOrderToTree(tree, ["Ghost", "Beta", "Alpha", "Gamma"])

    expect(pathsOf(ordered)).toEqual([
      "根目录",
      "Beta",
      "Beta / 子三",
      "Alpha",
      "Alpha / 子一",
      "Alpha / 子一 / 孙",
      "Alpha / 子二",
      "Gamma",
    ])
    expect(pathsOf(ordered)).not.toContain("Ghost")
  })

  it("没有系统根目录时也能正常重排", () => {
    const withoutRoot = tree.filter((entry) => entry.path !== "根目录")

    expect(pathsOf(applyFolderOrderToTree(withoutRoot, ["Gamma", "Alpha"]))).toEqual([
      "Gamma",
      "Alpha",
      "Alpha / 子一",
      "Alpha / 子一 / 孙",
      "Alpha / 子二",
      "Beta",
      "Beta / 子三",
    ])
  })
})

describe("reorderTopLevelPaths", () => {
  it("把拖动目标移动到落点位置", () => {
    expect(reorderTopLevelPaths(["A", "B", "C"], "C", "A")).toEqual(["C", "A", "B"])
    expect(reorderTopLevelPaths(["A", "B", "C"], "A", "C")).toEqual(["B", "C", "A"])
  })

  it("原地放置或目标无效时返回 null，调用方不会写盘", () => {
    expect(reorderTopLevelPaths(["A", "B"], "A", "A")).toBeNull()
    expect(reorderTopLevelPaths(["A", "B"], "A", "Missing")).toBeNull()
    expect(reorderTopLevelPaths(["A", "B"], "Missing", "A")).toBeNull()
  })
})

describe("moveFolderOrderPath", () => {
  it("重命名命中时迁移路径并保持原位置", () => {
    expect(moveFolderOrderPath(["Alpha", "Beta", "Gamma"], "Beta", "Delta")).toEqual(["Alpha", "Delta", "Gamma"])
  })

  it("历史遗留的子路径按前缀一起迁移", () => {
    expect(moveFolderOrderPath(["Alpha", "Beta / 子三"], "Beta", "Delta")).toEqual(["Alpha", "Delta / 子三"])
  })

  it("未命中时返回原数组引用，调用方据此保留原顺序", () => {
    const order = ["Alpha", "Beta"]
    expect(moveFolderOrderPath(order, "Missing", "Delta")).toBe(order)
  })
})
