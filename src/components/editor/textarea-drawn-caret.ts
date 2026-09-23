// iOS textarea 的插入线由系统绘制，DOM 兄弟层和裁剪边界挡不住它。
// Widget 编辑框保留原生输入与选区，只在选区收起时改用编辑区内的 DOM 光标。
export function installTextareaDrawnCaret(host: HTMLElement): () => void {
  const body = host.closest<HTMLElement>(".editor-body")
  if (!body) return () => {}

  const caret = document.createElement("span")
  caret.className = "editor-textarea-drawn-caret"
  caret.setAttribute("aria-hidden", "true")
  caret.hidden = true
  body.append(caret)

  const mirror = document.createElement("div")
  mirror.setAttribute("aria-hidden", "true")
  mirror.style.position = "fixed"
  mirror.style.left = "-10000px"
  mirror.style.top = "0"
  mirror.style.visibility = "hidden"
  mirror.style.pointerEvents = "none"
  document.body.append(mirror)

  let active: HTMLTextAreaElement | null = null
  let frame = 0

  const clearActive = () => {
    active?.removeAttribute("data-drawn-caret")
    active = null
    caret.hidden = true
  }

  const sync = () => {
    frame = 0
    const input = active
    if (!input?.isConnected || document.activeElement !== input || input.selectionStart !== input.selectionEnd) {
      if (input) input.removeAttribute("data-drawn-caret")
      caret.hidden = true
      return
    }

    const style = getComputedStyle(input)
    const inputRect = input.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    if (inputRect.width <= 0 || bodyRect.height <= 0) {
      caret.hidden = true
      return
    }

    // textarea 不能用 DOM Range 读取光标位置；同宽镜像复制换行与字体，
    // 只测选区起点。保留 textarea 本身，中文输入法组合态与键盘焦点不受影响。
    Object.assign(mirror.style, {
      boxSizing: style.boxSizing,
      width: `${inputRect.width}px`,
      padding: style.padding,
      border: style.border,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textAlign: style.textAlign,
      textIndent: style.textIndent,
      whiteSpace: "pre-wrap",
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      tabSize: style.tabSize,
    })
    const marker = document.createElement("span")
    marker.textContent = "\u200b"
    mirror.replaceChildren(document.createTextNode(input.value.slice(0, input.selectionStart)), marker)
    const markerRect = marker.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()
    const lineHeight = Number.parseFloat(style.lineHeight) || markerRect.height || Number.parseFloat(style.fontSize) * 1.2 || 24
    const left = inputRect.left + markerRect.left - mirrorRect.left - input.scrollLeft - bodyRect.left
    const top = inputRect.top + markerRect.top - mirrorRect.top - input.scrollTop - bodyRect.top
    caret.style.left = `${left}px`
    caret.style.top = `${top}px`
    caret.style.height = `${lineHeight}px`
    caret.hidden = false
    input.dataset.drawnCaret = "true"
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(sync)
  }
  const refreshFocus = () => {
    const focused = document.activeElement
    if (focused !== active) clearActive()
    if (focused instanceof HTMLTextAreaElement && host.contains(focused)) {
      active = focused
      schedule()
    }
  }
  const onFocusOut = () => queueMicrotask(refreshFocus)
  host.addEventListener("focusin", refreshFocus)
  host.addEventListener("focusout", onFocusOut)
  for (const type of ["input", "select", "keyup", "click", "compositionupdate"]) host.addEventListener(type, schedule)
  body.addEventListener("scroll", schedule, true)
  document.addEventListener("selectionchange", schedule)
  window.visualViewport?.addEventListener("resize", schedule)
  refreshFocus()

  return () => {
    if (frame) cancelAnimationFrame(frame)
    clearActive()
    host.removeEventListener("focusin", refreshFocus)
    host.removeEventListener("focusout", onFocusOut)
    for (const type of ["input", "select", "keyup", "click", "compositionupdate"]) host.removeEventListener(type, schedule)
    body.removeEventListener("scroll", schedule, true)
    document.removeEventListener("selectionchange", schedule)
    window.visualViewport?.removeEventListener("resize", schedule)
    caret.remove()
    mirror.remove()
  }
}
