import { isTauri } from "@tauri-apps/api/core"
import { Maximize2, Minus, X } from "lucide-react"
import type { ReactNode } from "react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"

type DesktopAppFrameProps = { children: ReactNode }

function isDesktopTauri() {
  return isTauri() && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function DesktopAppFrame({ children }: DesktopAppFrameProps) {
  if (!isDesktopTauri()) return children

  return (
    <div className="desktop-app-frame">
      <DesktopTitleBar />
      <div className="desktop-app-content">{children}</div>
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
