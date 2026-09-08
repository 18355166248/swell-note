import { isTauri } from "@tauri-apps/api/core"
import { Maximize2, Minus, X } from "lucide-react"
import type { ReactNode } from "react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"
import { useNativeContextMenuSuppression } from "@/components/desktop/native-context-menu"
import { TableContextMenu } from "@/components/workspace/table-context-menu"
import { TextContextMenu } from "@/components/workspace/text-context-menu"

type DesktopAppFrameProps = { children: ReactNode }

function isDesktopTauri() {
  return isTauri() && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function DesktopAppFrame({ children }: DesktopAppFrameProps) {
  const desktop = isDesktopTauri()
  // 浏览器和客户端统一使用应用菜单；普通输入框由 TextContextMenu 提供剪贴板操作。
  // TableContextMenu 必须挂在前面：表格空白处的右键先在它的捕获监听里接管，不会重复弹菜单。
  useNativeContextMenuSuppression(true)
  if (!desktop) return <>{children}<TableContextMenu /><TextContextMenu /></>

  return (
    <div className="desktop-app-frame">
      <DesktopTitleBar />
      <div className="desktop-app-content">{children}</div>
      <TableContextMenu />
      <TextContextMenu />
    </div>
  )
}

function DesktopTitleBar() {
  const mac = /Mac/i.test(navigator.platform)
  const run = (action: "close" | "minimize" | "toggleMaximize") => {
    // 窗口正在关闭时调用可能被系统中断；此处无需把无害的关闭竞态升级为应用错误。
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow()[action]())
      .catch(() => undefined)
  }

  return (
    <header
      className="desktop-titlebar"
      data-platform={mac ? "mac" : "windows"}
      data-tauri-drag-region
      onDoubleClick={() => run("toggleMaximize")}
    >
      {mac ? (
        <div className="desktop-window-controls desktop-window-controls-mac" aria-label="窗口控制">
          <button aria-label="关闭窗口" className="desktop-window-close" onClick={() => run("close")} type="button"><X /></button>
          <button aria-label="最小化窗口" className="desktop-window-minimize" onClick={() => run("minimize")} type="button"><Minus /></button>
          <button aria-label="最大化窗口" className="desktop-window-maximize" onClick={() => run("toggleMaximize")} type="button"><Maximize2 /></button>
        </div>
      ) : null}

      <div className="desktop-titlebar-brand" data-tauri-drag-region>
        <img alt="" src={swellNoteLogo} />
        <span>Swell Note</span>
      </div>

      {!mac ? (
        <div className="desktop-window-controls desktop-window-controls-windows" aria-label="窗口控制">
          <button aria-label="最小化窗口" onClick={() => run("minimize")} type="button"><Minus /></button>
          <button aria-label="最大化窗口" onClick={() => run("toggleMaximize")} type="button"><Maximize2 /></button>
          <button aria-label="关闭窗口" className="desktop-window-close" onClick={() => run("close")} type="button"><X /></button>
        </div>
      ) : null}
    </header>
  )
}
