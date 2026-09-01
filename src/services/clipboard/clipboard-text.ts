// 移动端 WebView 里的剪贴板并不总是走同一条路：iOS 的自定义 scheme 未必被判定为安全上下文，
// navigator.clipboard 可能整个缺席或调用即拒绝。写入因此保留 execCommand 回退，
// 读取没有等效回退（WebKit 早已禁用 execCommand("paste")），失败时如实返回 null 交给调用方提示。

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 交给下面的选区回退再试一次。
    }
  }
  return copyDocumentSelection()
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
  if (!selection || selection.isCollapsed) return false
  try {
    return document.execCommand("copy")
  } catch {
    return false
  }
}
