import { diffArrays } from "diff"

type MergeHunk = {
  end: number
  replacement: string[]
  side: "local" | "remote"
  start: number
}

export type ThreeWayMergeResult = {
  conflictCount: number
  content: string
}

function createHunks(base: string[], variant: string[], side: MergeHunk["side"]) {
  const hunks: MergeHunk[] = []
  let baseIndex = 0
  let current: MergeHunk | null = null

  const flush = () => {
    if (current) hunks.push(current)
    current = null
  }

  for (const change of diffArrays(base, variant)) {
    if (!change.added && !change.removed) {
      flush()
      baseIndex += change.value.length
      continue
    }
    current ??= { end: baseIndex, replacement: [], side, start: baseIndex }
    if (change.removed) {
      baseIndex += change.value.length
      current.end = baseIndex
    } else {
      current.replacement.push(...change.value)
    }
  }
  flush()
  return hunks
}

function hunksConflict(left: MergeHunk, right: MergeHunk) {
  if (left.side === right.side) return false
  const leftInsertion = left.start === left.end
  const rightInsertion = right.start === right.end
  if (leftInsertion && rightInsertion) return left.start === right.start
  if (leftInsertion) return left.start > right.start && left.start < right.end
  if (rightInsertion) return right.start > left.start && right.start < left.end
  return Math.max(left.start, right.start) < Math.min(left.end, right.end)
}

function applyHunks(base: string[], start: number, end: number, hunks: MergeHunk[]) {
  const result = base.slice(start, end)
  for (const hunk of [...hunks].sort((left, right) => right.start - left.start)) {
    result.splice(hunk.start - start, hunk.end - hunk.start, ...hunk.replacement)
  }
  return result
}

/**
 * 以最后一次成功读取的正文为基线做三方合并。不同位置的修改自动组合；同一区域的并发修改
 * 保留双方文本并插入冲突标记，避免任何一台设备的内容被静默覆盖。
 */
export function mergeMarkdownVersions(baseContent: string | undefined, localContent: string, remoteContent: string): ThreeWayMergeResult {
  if (localContent === remoteContent) return { conflictCount: 0, content: localContent }
  if (baseContent !== undefined && localContent === baseContent) return { conflictCount: 0, content: remoteContent }
  if (baseContent !== undefined && remoteContent === baseContent) return { conflictCount: 0, content: localContent }

  if (baseContent === undefined) {
    return {
      conflictCount: 1,
      content: ["<<<<<<< 本机", localContent, "=======", remoteContent, ">>>>>>> 云端"].join("\n"),
    }
  }

  const base = baseContent.split("\n")
  const hunks = [
    ...createHunks(base, localContent.split("\n"), "local"),
    ...createHunks(base, remoteContent.split("\n"), "remote"),
  ]
  const parents = hunks.map((_, index) => index)
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]))
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }

  for (let left = 0; left < hunks.length; left += 1) {
    for (let right = left + 1; right < hunks.length; right += 1) {
      if (hunksConflict(hunks[left], hunks[right])) union(left, right)
    }
  }

  const groups = new Map<number, MergeHunk[]>()
  hunks.forEach((hunk, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), hunk])
  })

  const output: string[] = []
  let cursor = 0
  let conflictCount = 0
  const orderedGroups = [...groups.values()].sort((left, right) => {
    const leftStart = Math.min(...left.map((hunk) => hunk.start))
    const rightStart = Math.min(...right.map((hunk) => hunk.start))
    if (leftStart !== rightStart) return leftStart - rightStart
    // 在同一基线位置，插入必须先于替换应用，保证输出游标只向前移动。
    const leftEnd = Math.max(...left.map((hunk) => hunk.end))
    const rightEnd = Math.max(...right.map((hunk) => hunk.end))
    return leftEnd - rightEnd
  })

  for (const group of orderedGroups) {
    const start = Math.min(...group.map((hunk) => hunk.start))
    const end = Math.max(...group.map((hunk) => hunk.end))
    output.push(...base.slice(cursor, start))
    const localHunks = group.filter((hunk) => hunk.side === "local")
    const remoteHunks = group.filter((hunk) => hunk.side === "remote")
    if (localHunks.length === 0 || remoteHunks.length === 0) {
      output.push(...applyHunks(base, start, end, group))
    } else {
      const local = applyHunks(base, start, end, localHunks)
      const remote = applyHunks(base, start, end, remoteHunks)
      if (local.join("\n") === remote.join("\n")) {
        output.push(...local)
      } else {
        conflictCount += 1
        output.push("<<<<<<< 本机", ...local, "=======", ...remote, ">>>>>>> 云端")
      }
    }
    cursor = end
  }
  output.push(...base.slice(cursor))
  return { conflictCount, content: output.join("\n") }
}
