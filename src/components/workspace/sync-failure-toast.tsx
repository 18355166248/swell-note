import { AlertTriangle, RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"

export function SyncFailureToast({ message, onDismiss, onRetry }: {
  message: string
  onDismiss: () => void
  onRetry: () => void
}) {
  return (
    <section aria-label="同步失败" className="workspace-sync-failure" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>同步没有完成</strong>
        <p>{message}</p>
      </div>
      <div className="workspace-sync-failure-actions">
        <Button onClick={onRetry} size="xs" variant="outline">
          <RefreshCw data-icon="inline-start" />重试同步
        </Button>
        <Button aria-label="关闭同步失败提示" onClick={onDismiss} size="icon-xs" variant="ghost">
          <X />
        </Button>
      </div>
    </section>
  )
}
