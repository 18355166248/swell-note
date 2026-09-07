// 移动端 WebView 里的剪贴板并不总是走同一条路：iOS 的自定义 scheme 未必被判定为安全上下文，
// navigator.clipboard 可能整个缺席或调用即拒绝。写入因此保留 execCommand 回退，
// 读取没有等效回退（WebKit 早已禁用 execCommand("paste")），失败时如实返回 null 交给调用方提示。

export async function writeClipboardText(text: string, fallback: "selection" | "text" = "selection"): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 交给下面的选区回退再试一次。
    }
  }
  return fallback === "text" ? copyExactText(text) : copyDocumentSelection()
}

function copyExactText(text: string) {
  // 链接地址不同于显示文字；原生回退必须复制入参，不能误复制页面上旧的选区。
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = document.createElement("textarea")
  input.value = text
  input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0"
  document.body.append(input)
  try {
    input.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    input.remove()
    if (focused?.isConnected) focused.focus({ preventScroll: true })
    if (selection && ranges.every((range) => range.startContainer.isConnected && range.endContainer.isConnected)) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}

export async function readClipboardText(): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    // iOS 会为读取弹一次系统授权，用户拒绝就走到这里。
    return null
  }
}

// 回退路径复制的是当前 DOM 选区而不是入参文本：调用方在选区上触发复制，两者本就是同一段内容，
// 这样也不必插入临时节点去抢走编辑器的焦点。
function copyDocumentSelection() {
  const selection = document.getSelection()
  const input = document.activeElement
  const inputSelected = (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
    && input.selectionStart !== null && input.selectionStart !== input.selectionEnd
  if ((!selection || selection.isCollapsed) && !inputSelected) return false
  try {
    return document.execCommand("copy")
  } catch {
    return false
  }
}
