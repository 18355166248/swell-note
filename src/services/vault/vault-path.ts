export function resolveVaultAssetPath(notePath: string, source: string) {
  const sourceWithoutSuffix = source.split(/[?#]/, 1)[0]
  if (!sourceWithoutSuffix || /^[a-z][a-z\d+.-]*:/i.test(sourceWithoutSuffix)) return null

  let decodedSource: string
  try {
    decodedSource = decodeURIComponent(sourceWithoutSuffix).replace(/\\/g, "/")
  } catch {
    return null
  }

  const absolute = notePath.startsWith("/")
  const baseSegments = decodedSource.startsWith("/")
    ? []
    : notePath.replace(/\\/g, "/").split("/").filter(Boolean).slice(0, -1)

  // 相对附件路径不能越过 Vault 根目录，避免读取用户未选择的相邻文件。
  for (const segment of decodedSource.split("/").filter(Boolean)) {
    if (segment === ".") continue
    if (segment === "..") {
      if (baseSegments.length === 0) return null
      baseSegments.pop()
      continue
    }
    baseSegments.push(segment)
  }

  if (baseSegments.length === 0) return null
  const resolved = baseSegments.join("/")
  return absolute ? `/${resolved}` : resolved
}
