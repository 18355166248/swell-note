import { LoaderCircle, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  getSyncProgressDescription,
  getSyncProgressPercent,
  type SyncProgress,
} from "@/services/sync/sync-progress"

export function SyncActivityToast({ onCancel, progress }: {
  onCancel: () => void
  progress: SyncProgress
}) {
  const percent = getSyncProgressPercent(progress)
  const finishing = progress.phase === "refreshing"

  return (
    <section
      aria-label="坚果云同步进度"
      className="workspace-sync-activity"
      data-phase={progress.phase}
    >
      <div aria-atomic="true" aria-live="polite" className="workspace-sync-activity-main" role="status">
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        <span>
          <strong>{progress.currentLabel}</strong>
          <small>{getSyncProgressDescription(progress)}</small>
        </span>
        <b>{percent}%</b>
      </div>
      <div
        aria-label={`同步进度 ${percent}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="workspace-sync-progress"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="workspace-sync-activity-action">
        {finishing ? <small>正在完成</small> : (
          <Button aria-label="取消同步" onClick={onCancel} size="xs" variant="ghost">
            <Square data-icon="inline-start" />取消
          </Button>
        )}
      </div>
    </section>
  )
}
