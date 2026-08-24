import { describe, expect, it } from "vitest"

import { mergeMarkdownVersions } from "@/services/sync/three-way-merge"

describe("多设备 Markdown 三方合并", () => {
  it("本机和另一台设备修改不同段落时自动合并", () => {
    const base = "# 周报\n\n进度：旧\n\n风险：旧"
    const local = "# 周报\n\n进度：本机已完成\n\n风险：旧"
    const remote = "# 周报\n\n进度：旧\n\n风险：云端已解除"

    expect(mergeMarkdownVersions(base, local, remote)).toEqual({
      conflictCount: 0,
      content: "# 周报\n\n进度：本机已完成\n\n风险：云端已解除",
    })
  })

  it("同一段被两台设备修改时保留双方内容和冲突标记", () => {
    const result = mergeMarkdownVersions("# 计划\n旧方案", "# 计划\n本机方案", "# 计划\n云端方案")

    expect(result.conflictCount).toBe(1)
    expect(result.content).toContain("<<<<<<< 本机\n本机方案\n=======\n云端方案\n>>>>>>> 云端")
  })

  it("缺少历史基线时不猜测覆盖关系", () => {
    const result = mergeMarkdownVersions(undefined, "本机草稿", "云端正文")
    expect(result.conflictCount).toBe(1)
    expect(result.content).toContain("本机草稿\n=======\n云端正文")
  })

  it("只有一侧变化时直接采用变化后的内容", () => {
    expect(mergeMarkdownVersions("原文", "本机修改", "原文")).toEqual({ conflictCount: 0, content: "本机修改" })
    expect(mergeMarkdownVersions("原文", "原文", "云端修改")).toEqual({ conflictCount: 0, content: "云端修改" })
  })

  it("一台设备在段落前插入、另一台修改该段落时保留两项修改", () => {
    expect(mergeMarkdownVersions("旧段落\n结尾", "本机插入\n旧段落\n结尾", "云端改写\n结尾")).toEqual({
      conflictCount: 0,
      content: "本机插入\n云端改写\n结尾",
    })
  })
})
