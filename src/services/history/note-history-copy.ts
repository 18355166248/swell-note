import { markdownExportFilename } from "@/services/export/markdown-export"

export function uniqueHistoryCopyPath({
  displaySourcePath,
  reservedStoragePaths,
  resolveStoragePath,
  sourceTitle,
  timestamp,
}: {
  displaySourcePath: string
  reservedStoragePaths: ReadonlySet<string>
  resolveStoragePath: (displayPath: string) => string
  sourceTitle: string
  timestamp: string
}) {
  const directory = displaySourcePath.split("/").slice(0, -1).join("/")
  const extension = /\.canvas$/i.test(displaySourcePath) ? ".canvas" : ".md"
  const stem = markdownExportFilename(`${sourceTitle} 历史副本 ${timestamp}`).replace(/\.md$/i, "")
  for (let copy = 1; copy < 10_000; copy += 1) {
    const filename = `${stem}${copy === 1 ? "" : ` (${copy})`}${extension}`
    const displayPath = `${directory ? `${directory}/` : ""}${filename}`
    const storagePath = resolveStoragePath(displayPath)
    if (!reservedStoragePaths.has(storagePath.replace(/\\/g, "/").toLocaleLowerCase())) {
      return { displayPath, filename, storagePath }
    }
  }
  throw new Error("无法为历史副本生成可用文件名")
}
