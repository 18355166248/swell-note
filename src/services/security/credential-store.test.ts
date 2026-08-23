import { beforeEach, describe, expect, it, vi } from "vitest"

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => tauriMocks)

import type { WebDavConfig } from "@/lib/webdav-config"
import {
  getCredentialStoreStatus,
  loadWebDavPassword,
  saveWebDavPassword,
} from "./credential-store"

const config: WebDavConfig = {
  provider: "jianguoyun",
  rememberPassword: true,
  remotePath: "/Swell/",
  serverUrl: "https://dav.jianguoyun.com/dav/",
  username: "user@example.com",
}

beforeEach(() => {
  tauriMocks.invoke.mockReset()
  tauriMocks.isTauri.mockReset()
})

describe("credential store", () => {
  it("Web 端固定使用当前会话且不会调用原生桥接", async () => {
    tauriMocks.isTauri.mockReturnValue(false)

    await expect(getCredentialStoreStatus()).resolves.toEqual({
      available: false,
      native: false,
      store: "当前浏览器会话",
    })
    await expect(loadWebDavPassword(config)).resolves.toBeNull()
    await saveWebDavPassword(config, "secret")
    expect(tauriMocks.invoke).not.toHaveBeenCalled()
  })

  it("原生端只在用户开启记住密码后读写系统凭据库", async () => {
    tauriMocks.isTauri.mockReturnValue(true)
    tauriMocks.invoke.mockResolvedValueOnce("saved-secret").mockResolvedValueOnce(undefined)

    await expect(loadWebDavPassword(config)).resolves.toBe("saved-secret")
    await saveWebDavPassword(config, "new-secret")
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "load_webdav_password", { account: config.username })
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "save_webdav_password", {
      account: config.username,
      password: "new-secret",
    })
  })
})
