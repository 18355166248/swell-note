import { describe, expect, it } from "vitest"

import { remarkObsidian } from "./remark-obsidian"

describe("remark Obsidian compatibility", () => {
  it("turns callout markers into semantic aside nodes", () => {
    const tree: any = {
      children: [{
        children: [{ children: [{ type: "text", value: "[!warning] 注意\n正文" }], type: "paragraph" }],
        type: "blockquote",
      }],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].data?.hName).toBe("aside")
    expect(tree.children[0].data?.hProperties?.["data-callout"]).toBe("warning")
    expect(tree.children[0].children[0].children[0].value).toBe("注意")
  })

  it("removes visible block ids and exposes a navigation anchor", () => {
    const tree: any = {
      children: [{ children: [{ type: "text", value: "任务正文 ^task-01" }], type: "paragraph" }],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].children[0].value).toBe("任务正文")
    expect(tree.children[0].data?.hProperties?.id).toBe("block-task-01")
  })

  it("uses details and summary for foldable callouts", () => {
    const tree: any = {
      children: [{
        children: [{ children: [{ type: "text", value: "[!note]- 默认折叠\n正文" }], type: "paragraph" }],
        type: "blockquote",
      }],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].data.hName).toBe("details")
    expect(tree.children[0].children[0].data.hName).toBe("summary")
    expect(tree.children[0].data.hProperties["data-fold"]).toBe("-")
  })

  it("promotes a standalone note embed to a block node", () => {
    const tree: any = {
      children: [{
        children: [{ type: "link", url: "swell-note://embed/%E4%BA%A7%E5%93%81%E7%81%B5%E6%84%9F" }],
        type: "paragraph",
      }],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].data).toEqual({
      hName: "div",
      hProperties: { "data-wiki-embed": "产品灵感" },
    })
    expect(tree.children[0].children).toEqual([])
  })

  it("wraps ==highlights== in mark nodes and keeps surrounding text", () => {
    const tree: any = {
      children: [{
        children: [{ type: "text", value: "重点 ==是这里== 以及后续" }],
        type: "paragraph",
      }],
      type: "root",
    }

    remarkObsidian()(tree)

    const children = tree.children[0].children
    expect(children).toHaveLength(3)
    expect(children[0]).toEqual({ type: "text", value: "重点 " })
    expect(children[1]).toEqual({ type: "text", value: "是这里", data: { hName: "mark" } })
    expect(children[2]).toEqual({ type: "text", value: " 以及后续" })
  })

  it("drops inline %%comments%% from the rendered body", () => {
    const tree: any = {
      children: [{
        children: [{ type: "text", value: "可见内容 %%内部注释%% 结尾" }],
        type: "paragraph",
      }],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].children).toEqual([
      { type: "text", value: "可见内容 " },
      { type: "text", value: " 结尾" },
    ])
  })

  it("hides paragraphs that consist only of a comment", () => {
    const tree: any = {
      children: [
        { children: [{ type: "text", value: "%%整段注释%%" }], type: "paragraph" },
        { children: [{ type: "text", value: "正文" }], type: "paragraph" },
      ],
      type: "root",
    }

    remarkObsidian()(tree)

    expect(tree.children[0].children).toEqual([])
    expect(tree.children[0].data?.hProperties?.hidden).toBe(true)
    expect(tree.children[1].children).toEqual([{ type: "text", value: "正文" }])
  })
})
