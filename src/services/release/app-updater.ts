import { isTauri } from "@tauri-apps/api/core"

export type AppUpdateProgress = {
  downloaded: number
  total?: number
}

export function supportsAppUpdater() {
  if (!isTauri()) return false
  // Tauri 官方 Updater 当前用于桌面安装包；移动端继续由应用商店负责版本更新。
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export async function checkForAppUpdate() {
  if (!supportsAppUpdater()) return null
  const { check } = await import("@tauri-apps/plugin-updater")
  return check({ timeout: 20_000 })
}

export type AppUpdate = NonNullable<Awaited<ReturnType<typeof checkForAppUpdate>>>

export async function installAppUpdate(
  update: AppUpdate,
  onProgress: (progress: AppUpdateProgress) => void,
) {
  let downloaded = 0
  let total: number | undefined
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength
    if (event.event === "Progress") downloaded += event.data.chunkLength
    onProgress({ downloaded, total })
  })
  const { relaunch } = await import("@tauri-apps/plugin-process")
  await relaunch()
}
