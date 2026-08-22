export const JIANGUOYUN_WEBDAV_URL = "https://dav.jianguoyun.com/dav/"

const STORAGE_KEY = "swell-note:webdav-config:v1"

export type WebDavConfig = {
  provider: "jianguoyun"
  serverUrl: string
  username: string
  remotePath: string
}

const defaultConfig: WebDavConfig = {
  provider: "jianguoyun",
  serverUrl: JIANGUOYUN_WEBDAV_URL,
  username: import.meta.env.VITE_DEFAULT_WEBDAV_USERNAME ?? "",
  remotePath: "/SwellNote/",
}

export function loadWebDavConfig(): WebDavConfig {
  const storedConfig = localStorage.getItem(STORAGE_KEY)
  if (!storedConfig) return defaultConfig

  try {
    const parsedConfig = JSON.parse(storedConfig) as Partial<WebDavConfig>
    return {
      ...defaultConfig,
      ...parsedConfig,
      provider: "jianguoyun",
    }
  } catch {
    return defaultConfig
  }
}

export function saveWebDavConfig(config: WebDavConfig) {
  // 普通连接参数采用版本化存储；应用密码绝不能进入 localStorage。
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function hasSavedWebDavConfig() {
  return localStorage.getItem(STORAGE_KEY) !== null
}
