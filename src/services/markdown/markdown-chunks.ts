// 阅读态分块：长笔记整篇解析会把主线程连续占住三百多毫秒，切到阅读态时整个界面卡住一拍。
// 这里把正文切成若干段独立的 Markdown，交给阅读态分帧渲染，单次解析的体量随之降到一段。
//
// 切割只允许发生在「空行之后、且前后两段互不依赖」的位置，保证每一段单独解析的结果与整篇一致。
// 拿不准的写法（引用式链接、脚注、松散列表、缩进代码）一律不切，宁可退回整篇渲染。

export type MarkdownChunk = {
  // 本段首行在正文中的行号（1 起），用于把段内 hast 行号换算回源文件行号。
  startLine: number
  text: string
}

export type MarkdownChunkOptions = {
  // 单段的目标下限；到量之后在下一个安全边界收口，避免切出上百个碎段。
  minChars?: number
  // 短笔记整篇解析本来就很快，切分只会白白增加开销。
  threshold?: number
}

const DEFAULT_MIN_CHARS = 2400
const DEFAULT_THRESHOLD = 12_000

// 引用式链接与脚注的定义可以写在文档任意位置，被引用处却在别的段落里；
// 一旦切开，定义就不在同一次解析中，链接会退化成纯文本。出现这类定义时整篇渲染。
const crossBlockDefinitionPattern = /^ {0,3}\[[^\]\n]+\]:/m
const fencePattern = /^ {0,3}(`{3,}|~{3,})/
const listItemPattern = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/

export function splitMarkdownIntoChunks(source: string, options: MarkdownChunkOptions = {}): MarkdownChunk[] {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const whole = [{ startLine: 1, text: source }]
  if (source.length <= threshold || crossBlockDefinitionPattern.test(source)) return whole

  const lines = source.split("\n")
  const chunks: MarkdownChunk[] = []
  let chunkStart = 0
  let chunkLength = 0
  let fence: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!fence && chunkLength >= minChars && isSafeBoundary(lines, index)) {
      chunks.push({ startLine: chunkStart + 1, text: lines.slice(chunkStart, index).join("\n") })
      chunkStart = index
      chunkLength = 0
    }
    chunkLength += line.length + 1

    const marker = line.match(fencePattern)?.[1]
    if (!marker) continue
    if (!fence) fence = marker[0]
    else if (fence === marker[0]) fence = null
  }
  if (chunkStart < lines.length) {
    chunks.push({ startLine: chunkStart + 1, text: lines.slice(chunkStart).join("\n") })
  }
  return chunks.length > 1 ? chunks : whole
}

// 判断「在第 index 行之前切开」是否安全；调用方已确保此处不在围栏代码块内。
function isSafeBoundary(lines: string[], index: number) {
  if (index <= 0) return false
  const line = lines[index]
  // 必须紧跟在空行之后：块级结构在空行处天然收束。
  if (!isBlank(lines[index - 1]) || isBlank(line)) return false
  // 有缩进说明还在列表项正文或缩进代码块里面。
  if (/^[ \t]/.test(line)) return false

  const previous = previousContentLine(lines, index)
  if (previous === null) return false
  // 松散列表的两项之间也隔着空行，切开会变成两个列表；有序列表还会重新起编号。
  if (listItemPattern.test(line) && isListContext(lines, previous)) return false
  return true
}

function isBlank(line: string) {
  return line.trim() === ""
}

function previousContentLine(lines: string[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!isBlank(lines[cursor])) return cursor
  }
  return null
}

// 列表项的续行只有缩进、没有标记，往上找到最近的非缩进行才能判断它属不属于列表。
function isListContext(lines: string[], index: number) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const line = lines[cursor]
    if (isBlank(line)) continue
    if (listItemPattern.test(line)) return true
    if (!/^[ \t]/.test(line)) return false
  }
  return false
}
