import { describe, expect, it } from "vitest"
import { tableCellEditorValue } from "./table-cell-editing"

describe("单元格编辑态换行", () => {
  it("还原换行标签并映射点击位置，兼容大小写和自闭合形式", () => {
    expect(tableCellEditorValue("甲<br>乙<BR />丙", 6)).toEqual({ text: "甲\n乙\n丙", offset: 3 })
    expect(tableCellEditorValue("甲<br>乙", 0).offset).toBe(0)
    expect(tableCellEditorValue("<br><br>").text).toBe("\n\n")
  })
  it("保留代码、转义文本和实体，强调里的换行仍可编辑", () => {
    expect(tableCellEditorValue("`<br>` \\<br> &lt;br&gt; **甲<br>乙**").text).toBe("`<br>` \\<br> &lt;br&gt; **甲\n乙**")
  })
})
