import { writeFile } from "node:fs/promises"

const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
if (!publicKey) throw new Error("Missing TAURI_UPDATER_PUBLIC_KEY")

// 发布配置只在 CI 中生成，公钥可以公开；私钥始终只通过 Tauri 官方环境变量传给构建器。
const config = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      endpoints: ["https://github.com/18355166248/swell-note/releases/latest/download/latest.json"],
      pubkey: publicKey,
      windows: { installMode: "passive" },
    },
  },
}

const windowsThumbprint = process.env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim()
if (windowsThumbprint) {
  config.bundle.windows = {
    certificateThumbprint: windowsThumbprint,
    digestAlgorithm: "sha256",
    timestampUrl: "http://timestamp.digicert.com",
  }
}

await writeFile("src-tauri/tauri.release.conf.json", `${JSON.stringify(config, null, 2)}\n`)
