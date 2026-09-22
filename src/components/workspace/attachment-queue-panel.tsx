import { useSyncExternalStore } from "react"
import { AlertCircle, Check, CircleSlash, LoaderCircle, RotateCcw, X } from "lucide-react"

import type { AttachmentQueue, AttachmentQueueBatch, AttachmentQueueItem } from "@/services/vault/attachment-queue"

/**
 * 订阅附件队列。队列实例在 App 里常驻，这里只把它的快照接进 React。
 *
 * getServerSnapshot 返回空数组：这些组件在服务端渲染下没有意义的队列状态，
 * 返回稳定引用也不会让每次渲染都换一个新对象。
 */
export function useAttachmentQueue(queue: AttachmentQueue) {
  return useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.getSnapshot(),
    () => EMPTY_BATCHES,
  )
}

const EMPTY_BATCHES: AttachmentQueueBatch[] = []

/**
 * 附件写入队列面板。
 *
 * 进度一律按「第几个文件 / 共几个 + 每个文件的状态」呈现：底层写盘没有字节进度回调，
 * 编一个百分比只会让慢的时候更像卡死了。等待中的可以取消，失败的可以只重试失败项。
 */
export function AttachmentQueuePanel({ batches, onCancel, onDismiss, onRetry }: {
  batches: AttachmentQueueBatch[]
  onCancel: (batchId: string) => void
  onDismiss: (batchId: string) => void
  onRetry: (batchId: string) => void
}) {
  if (batches.length === 0) return null
  return (
    <section aria-label="附件写入队列" className="attachment-queue">
      {batches.map((batch) => <BatchRow batch={batch} key={batch.id} onCancel={onCancel} onDismiss={onDismiss} onRetry={onRetry} />)}
    </section>
  )
}

function BatchRow({ batch, onCancel, onDismiss, onRetry }: {
  batch: AttachmentQueueBatch
  onCancel: (batchId: string) => void
  onDismiss: (batchId: string) => void
  onRetry: (batchId: string) => void
}) {
  const done = batch.items.filter((item) => item.status === "done").length
  const failed = batch.items.filter((item) => item.status === "failed").length
  const retryable = batch.retryableCount ?? failed
  const cancelled = batch.items.filter((item) => item.status === "cancelled").length
  const active = batch.status === "queued" || batch.status === "writing"
  // 真实进度：只有「已写完 / 总数」，没有字节数就不说字节数。
  const progress = `${done + failed + cancelled} / ${batch.items.length}`
  // 文件写入与正文插入是两件事。文件写进去了、引用却没进正文时，说「已插入 N 个」是假消息。
  const inserted = batch.insertion === "inserted" || batch.insertion === "appended"

  return (
    <div className="attachment-queue-batch" data-status={batch.status} role="status">
      <div className="attachment-queue-head">
        <BatchIcon batch={batch} />
        <span className="attachment-queue-title">
          {batch.status === "queued" ? "等待写入" : null}
          {batch.status === "writing" ? (batch.items.length > 1 ? `正在写入（${progress}）` : "正在写入") : null}
          {batch.status === "done" ? (inserted ? `已插入 ${done} 个附件` : `已写入 ${done} 个附件，正文引用未插入`) : null}
          {batch.status === "failed" ? (done > 0 ? `部分成功：成功 ${done} 个，失败 ${failed} 个` : `写入失败（${failed} 个）`) : null}
          {batch.status === "cancelled" ? (done > 0
            ? (inserted ? `已取消，仍有 ${done} 个已写入并插入正文` : `已取消，仍有 ${done} 个已写入但未插入正文`)
            : "已取消") : null}
        </span>
        <span className="attachment-queue-target">{batch.target.noteTitle || "未命名笔记"}</span>
        {active ? (
          <button
            aria-label="取消这批附件"
            className="attachment-queue-action"
            onClick={() => onCancel(batch.id)}
            type="button"
          >
            <X />
          </button>
        ) : (
          <button
            aria-label="从队列中移除这条记录"
            className="attachment-queue-action"
            disabled={batch.retrying}
            onClick={() => onDismiss(batch.id)}
            type="button"
          >
            <X />
          </button>
        )}
      </div>
      <ul className="attachment-queue-items">
        {batch.items.map((item) => (
          <li data-status={item.status} key={item.id}>
            <ItemIcon status={item.status} />
            <span className="attachment-queue-name">{item.name}</span>
            <span className="attachment-queue-state">{itemStatusLabel(item)}</span>
          </li>
        ))}
      </ul>
      {batch.notice ? <p className="attachment-queue-notice">{batch.notice}</p> : null}
      {!active && retryable > 0 ? (
        // 重试期间禁用：此时失败项正排在新批次里重传，再点一次会把同一个文件传两遍。
        <button
          className="attachment-queue-retry"
          disabled={batch.retrying}
          onClick={() => onRetry(batch.id)}
          type="button"
        >
          <RotateCcw />
          {batch.retrying ? `正在重试 ${retryable} 个` : `只重试失败的 ${retryable} 个`}
        </button>
      ) : null}
    </div>
  )
}

function BatchIcon({ batch }: { batch: AttachmentQueueBatch }) {
  if (batch.status === "done") return <Check className="attachment-queue-icon" data-state="done" />
  if (batch.status === "failed") return <AlertCircle className="attachment-queue-icon" data-state="failed" />
  if (batch.status === "cancelled") return <CircleSlash className="attachment-queue-icon" data-state="cancelled" />
  return <LoaderCircle className="attachment-queue-icon animate-spin" data-state="busy" />
}

function ItemIcon({ status }: { status: AttachmentQueueItem["status"] }) {
  if (status === "done") return <Check className="attachment-queue-item-icon" data-state="done" />
  if (status === "failed") return <AlertCircle className="attachment-queue-item-icon" data-state="failed" />
  if (status === "cancelled") return <CircleSlash className="attachment-queue-item-icon" data-state="cancelled" />
  if (status === "writing") return <LoaderCircle className="attachment-queue-item-icon animate-spin" data-state="busy" />
  return <span aria-hidden="true" className="attachment-queue-item-dot" />
}

function itemStatusLabel(item: AttachmentQueueItem) {
  if (item.status === "waiting") return "等待中"
  if (item.status === "writing") return "写入中"
  // 重试补上的项也标出「重试」：否则这条记录会从「失败」直接变成「已写入」，看不出发生过什么。
  if (item.status === "done") return item.retried ? "已写入（重试补上）" : "已写入"
  if (item.status === "cancelled") return "已取消"
  return item.error ?? "写入失败"
}
