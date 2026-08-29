import { isTauri } from "@tauri-apps/api/core"

export function markdownExportFilename(value: string) {
  const safe = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, 120) || "未命名笔记"
  return /\.md$/i.test(safe) ? safe : `${safe}.md`
}

export async function exportMarkdownDocument(content: string, suggestedName: string) {
  const filename = markdownExportFilename(suggestedName)
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ])
    const path = await save({
      defaultPath: filename,
      filters: [{ extensions: ["md"], name: "Markdown" }],
      title: "导出 Markdown 笔记",
    })
    if (!path) return false
    await writeTextFile(path, content)
    return true
  }

  // Web 端使用标准下载，不申请文件系统权限，也不会改变当前 Vault 或同步状态。
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.download = filename
  anchor.href = url
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return true
}
