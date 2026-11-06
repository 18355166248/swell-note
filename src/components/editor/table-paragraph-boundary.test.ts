import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdownTableEditing } from './live-preview'

const table = '| A | B |\n| --- | --- |\n| 一 | 二 |'
const source = table + '\n\nios: 正文\n安卓: 正文'
function state(doc = source, grid = true) {
  const value = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), ...(grid ? [markdownTableEditing()] : [])] })
  ensureSyntaxTree(value, doc.length, 100)
  return value
}

describe('网格后的正文输入边界', () => {
  it.each(['input.type', 'input.type.compose', 'input.paste'])('唯一空行输入保留分隔并映射光标：%s', (userEvent) => {
    const from = table.length + 1
    const tr = state().update({ changes: { from, insert: '新增' }, selection: { anchor: from + 2 }, userEvent })
    expect(tr.newDoc.toString()).toBe(table + '\n\n新增\nios: 正文\n安卓: 正文')
    expect(tr.newSelection.main.head).toBe(from + 3)
  })
  it('表格末尾空行输入与多行粘贴仍在表格之外', () => {
    const from = table.length + 1
    expect(state(table + '\n').update({ changes: { from, insert: '甲\n乙' }, userEvent: 'input.paste' }).newDoc.toString()).toBe(table + '\n\n甲\n乙')
  })
  it('已有空白分隔的正文、Enter、源码模式和程序更新不补空行', () => {
    const from = table.length + 1
    expect(state().update({ changes: { from, insert: '\n' }, userEvent: 'input.type' }).newDoc.toString()).toBe(table + '\n\n\nios: 正文\n安卓: 正文')
    for (const userEvent of ['input.table', undefined]) {
      expect(state().update({ changes: { from, insert: '1' }, userEvent }).newDoc.toString()).toBe(table + '\n1\nios: 正文\n安卓: 正文')
    }
    expect(state(source, false).update({ changes: { from, insert: '1' }, userEvent: 'input.type' }).newDoc.toString()).toBe(table + '\n1\nios: 正文\n安卓: 正文')
    expect(state().update({ changes: { from: from + 1, insert: '1' }, userEvent: 'input.type' }).newDoc.toString()).toBe(table + '\n\n1ios: 正文\n安卓: 正文')
  })
  it('代码块中的表格样式文字不触发正文边界保护', () => {
    const doc = '```\n' + table + '\n\n正文\n```'
    const from = 4 + table.length + 1
    expect(state(doc).update({ changes: { from, insert: '1' }, userEvent: 'input.type' }).newDoc.toString()).toBe(doc.slice(0, from) + '1' + doc.slice(from))
  })
})
