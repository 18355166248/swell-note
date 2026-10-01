// @vitest-environment jsdom
import { markdown } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"

import { markdownLivePreviewBase } from "./live-preview"

let view: EditorView | undefined
afterEach(() => { view?.destroy(); view = undefined; vi.restoreAllMocks() })

async function createView(readOnly = false, touchPoints = 0) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => touchPoints })
  const opened = vi.fn()
  view = new EditorView({ parent: document.body, state: EditorState.create({
    doc: "开始\n\n[[另一篇|标签]]\n\n[网站](https://example.com)",
    extensions: [markdown(), EditorState.readOnly.of(readOnly), markdownLivePreviewBase({
      onOpenWikiLink: opened, onOpenExternalLink: opened,
    })],
  }) })
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { opened, link: view.contentDOM.querySelector<HTMLElement>("[data-wiki-target]")! }
}

describe("Mac editing links", () => {
  it("leaves plain press/click available for cursor placement and drag selection", async () => {
    const { link, opened } = await createView()
    vi.spyOn(view!, "posAtCoords").mockReturnValue(10)
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(opened).not.toHaveBeenCalled()
  })

  it("Cmd click opens once and Cmd+Enter still opens at the cursor", async () => {
    const { link, opened } = await createView()
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true }))
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }))
    expect(opened).toHaveBeenCalledExactlyOnceWith("另一篇")
    view!.dispatch({ selection: { anchor: 10 } })
    view!.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }))
    expect(opened).toHaveBeenCalledTimes(2)
  })

  it.each([{ readOnly: true, touchPoints: 0 }, { readOnly: false, touchPoints: 5 }, { readOnly: false, touchPoints: 1 }])("retains plain activation for reading/touch ($readOnly, $touchPoints)", async ({ readOnly, touchPoints }) => {
    const { link, opened } = await createView(readOnly, touchPoints)
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    expect(opened).toHaveBeenCalledExactlyOnceWith("另一篇")
  })
})
