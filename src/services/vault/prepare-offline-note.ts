import { extractAttachmentSources } from "./attachment-maintenance"
import type { VaultAsset } from "./vault-adapter"

export type OfflineAssetResult = { source: string; bytes: number; error?: string }
export async function prepareOfflineNote(content: string, readAsset: (source: string) => Promise<VaultAsset | null>, onResult: (result: OfflineAssetResult) => void, isCurrent: () => boolean) {
  const sources = [...new Set(extractAttachmentSources(content))].filter((source) =>
    !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source) && !/\.(?:md|canvas)(?:#.*)?$/i.test(source))
  // 顺序读取避免手机同时载入多个大附件；关闭或换笔记后停止启动后续请求。
  for (const source of sources) {
    if (!isCurrent()) return
    let result: OfflineAssetResult
    try {
      const asset = await readAsset(source)
      if (!asset) throw new Error("附件不可读取，请检查连接和文件路径")
      result = { source, bytes: asset.data.byteLength }
    } catch (error) { result = { source, bytes: 0, error: error instanceof Error ? error.message : "读取失败" } }
    if (isCurrent()) onResult(result)
  }
}
