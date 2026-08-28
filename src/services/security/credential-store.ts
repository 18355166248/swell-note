import { invoke, isTauri } from "@tauri-apps/api/core"

import type { WebDavConfig } from "@/lib/webdav-config"

export type CredentialStoreStatus = {
  available: boolean
  native: boolean
  store: string
}

const WEB_STATUS: CredentialStoreStatus = {
  available: false,
  native: false,
  store: "当前浏览器会话",
}

export async function getCredentialStoreStatus(): Promise<CredentialStoreStatus> {
  if (!isTauri()) return WEB_STATUS
  try {
    const status = await invoke<Omit<CredentialStoreStatus, "native">>("credential_store_status")
    return { ...status, native: true }
  } catch {
    // 原生桥接不可用时按 Web 安全边界降级，绝不改用 localStorage 保存密码。
    return { available: false, native: true, store: "系统安全存储" }
  }
}

export async function loadWebDavPassword(config: WebDavConfig) {
  // 原生安装版默认使用系统凭据库，首次验证成功后即可跨重启复用；Web 端始终返回空值。
  if (!isTauri()) return null
  return invoke<string | null>("load_webdav_password", { account: config.username })
}

export async function saveWebDavPassword(config: WebDavConfig, password: string) {
  if (!isTauri()) return
  await invoke("save_webdav_password", { account: config.username, password })
}

export async function deleteWebDavPassword(config: WebDavConfig) {
  if (!isTauri()) return
  await invoke("delete_webdav_password", { account: config.username })
}
