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
})
