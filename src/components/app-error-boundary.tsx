import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

type AppErrorBoundaryProps = { children: ReactNode }
type AppErrorBoundaryState = { error: Error | null }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 顶层兜底只记录非敏感错误摘要；笔记正文与 WebDAV 凭据不能进入日志。
    console.error("Swell Note 页面渲染失败", { message: error.message, stack: info.componentStack })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunkFailed = /dynamically imported module|fetch.*module|loading chunk/i.test(this.state.error.message)
    return (
      <main className="app-crash-state" role="alert">
        <span className="app-crash-icon"><AlertTriangle /></span>
        <h1>{chunkFailed ? "页面资源没有加载成功" : "Swell Note 暂时无法显示"}</h1>
        <p>{chunkFailed ? "本地笔记缓存仍然安全。请确认应用服务可用后重新加载。" : "本地修改不会因此上传或丢失，可以重新加载后继续。"}</p>
        <Button onClick={() => window.location.reload()}><RefreshCw />重新加载</Button>
      </main>
    )
  }
}
