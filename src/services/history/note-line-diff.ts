import { diffArrays } from "diff"

export type NoteDiffRow = {
  currentLine?: number
  kind: "added" | "context" | "omitted" | "removed"
  omittedCount?: number
  selectedLine?: number
  text: string
}

export function buildNoteLineDiff(current: string, selected: string) {
  const rows: NoteDiffRow[] = []
  let currentLine = 1
  let selectedLine = 1
  let added = 0
  let removed = 0
  const currentLines = current.split("\n")
  const selectedLines = selected.split("\n")
  const preciseParts = diffArrays(currentLines, selectedLines, { maxEditLength: 2_000, timeout: 80 })
  const parts = preciseParts ?? simplifiedParts(currentLines, selectedLines)

  // 差异方向固定为“当前正文 → 所选历史”：绿色行会写入，红色行会从副本或恢复结果中消失。
  for (const part of parts) {
    const unchanged = !part.added && !part.removed
    const count = part.value.length
    for (let index = 0; index < count; index += 1) {
      if (unchanged && count > 8 && index === 3) {
        const omittedCount = count - 6
        rows.push({ kind: "omitted", omittedCount, text: `省略 ${omittedCount} 行未变化内容` })
        currentLine += omittedCount
        selectedLine += omittedCount
      }
      if (unchanged && count > 8 && index >= 3 && index < count - 3) continue
      if (part.added) {
        rows.push({ kind: "added", selectedLine: selectedLine++, text: part.value[index] })
        added += 1
      } else if (part.removed) {
        rows.push({ currentLine: currentLine++, kind: "removed", text: part.value[index] })
        removed += 1
      } else {
        rows.push({ currentLine: currentLine++, kind: "context", selectedLine: selectedLine++, text: part.value[index] })
      }
    }
  }

  const truncated = rows.length > 800
  if (truncated) {
    const omittedCount = rows.length - 600
    rows.splice(300, omittedCount, { kind: "omitted", omittedCount, text: `省略 ${omittedCount} 行差异预览` })
  }
  return { added, removed, rows, simplified: !preciseParts, truncated }
}

function simplifiedParts(current: string[], selected: string[]) {
  let prefix = 0
  while (prefix < current.length && prefix < selected.length && current[prefix] === selected[prefix]) prefix += 1
  let suffix = 0
  while (suffix < current.length - prefix && suffix < selected.length - prefix
    && current[current.length - 1 - suffix] === selected[selected.length - 1 - suffix]) suffix += 1
  return [
    { value: current.slice(0, prefix) },
    { removed: true, value: current.slice(prefix, current.length - suffix) },
    { added: true, value: selected.slice(prefix, selected.length - suffix) },
    { value: suffix ? current.slice(current.length - suffix) : [] },
  ]
}
