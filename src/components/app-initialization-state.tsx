import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"
import { Button } from "@/components/ui/button"

type AppInitializationStateProps = {
  error?: string | null
  onContinue?: () => void
  onRetry?: () => void
}

export function AppInitializationState({ error, onContinue, onRetry }: AppInitializationStateProps) {
  const failed = Boolean(error)

  return (
    <main className="app-initialization-state" data-status={failed ? "error" : "loading"} role={failed ? "alert" : "status"} aria-live="polite">
      <div className="app-initialization-brand">
        <img alt="" src={swellNoteLogo} />
        <strong>Swell Note</strong>
      </div>
      <span className="app-initialization-icon" aria-hidden="true">
        {failed ? <AlertTriangle /> : <LoaderCircle className="app-loading-spinner" />}
      </span>
      <h1>{failed ? "本机缓存暂时无法读取" : "正在恢复工作区"}</h1>
      <p>{failed ? error : "正在读取上次打开的笔记库、笔记内容和浏览位置，请稍候。"}</p>
      {failed ? (
        <div className="app-initialization-actions">
          <Button onClick={onRetry}><RefreshCw />重新尝试</Button>
          <Button onClick={onContinue} variant="outline">暂不恢复</Button>
        </div>
      ) : <div className="app-initialization-progress" aria-hidden="true"><span /></div>}
    </main>
  )
}
