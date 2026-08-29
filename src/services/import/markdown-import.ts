export const MAX_MARKDOWN_IMPORT_BYTES = 5 * 1024 * 1024

export function sanitizeImportedMarkdownName(value: string) {
  const safe = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, 120)
  if (!safe || !/\.md$/i.test(safe)) return null
  return safe
}

export function uniqueMarkdownPath(
  directory: string,
  filename: string,
  resolveStoragePath: (displayPath: string) => string,
  reservedStoragePaths: Set<string>,
) {
  const stem = filename.replace(/\.md$/i, "")
  for (let copy = 1; copy < 10_000; copy += 1) {
    const candidateName = copy === 1 ? filename : `${stem} (${copy}).md`
    const displayPath = `${directory ? `${directory.replace(/\/+$/g, "")}/` : ""}${candidateName}`
    const storagePath = resolveStoragePath(displayPath)
    const key = storagePath.replace(/\\/g, "/").toLocaleLowerCase()
    if (reservedStoragePaths.has(key)) continue
    reservedStoragePaths.add(key)
    return { displayPath, storagePath }
  }
  throw new Error(`无法为 ${filename} 生成可用文件名`)
}
