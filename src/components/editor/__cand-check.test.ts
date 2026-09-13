import { it } from "vitest"
import { markdownLanguage } from "@codemirror/lang-markdown"

function dump(doc: string) {
  const tree = markdownLanguage.parser.parse(doc)
  const chars: Record<string, string[]> = {}
  const text = doc.replace(/[*`~]/g, "")
  // 逐字符收集包含它的格式节点
  let ti = 0
  for (let i = 0; i < doc.length && ti < text.length; i++) {
    if ("*`~".includes(doc[i])) continue
    const ch = doc[i], marks: string[] = []
    tree.iterate({ enter(n) {
      if (["StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode"].includes(n.name) && n.from <= i && n.to > i) marks.push(n.name)
    } })
    chars[ch] = marks
    ti++
  }
  console.log(JSON.stringify(doc), "→", JSON.stringify(chars))
}

it("candidates", () => {
  dump("**甲*乙**")           // 期望：甲 strong，乙 strong+em
  dump("**甲*乙****丙***丁**") // 期望：甲S 乙S+E 丙E 丁S
  dump("**甲*乙***丙***丁**")
  dump("*甲**乙丙**丁*")       // 反向场景：斜体内拆加粗
})
