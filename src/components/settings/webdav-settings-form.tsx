import { useState } from "react"
import { AlertCircle, Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  JIANGUOYUN_WEBDAV_URL,
  loadWebDavConfig,
  saveWebDavConfig,
  type WebDavConfig,
} from "@/lib/webdav-config"

export function WebDavSettingsForm({
  onConnect,
  onConnected,
  onSaved,
}: {
  onConnect: (config: WebDavConfig, password: string) => Promise<number>
  onConnected: () => void
  onSaved: () => void
}) {
  const [config, setConfig] = useState<WebDavConfig>(loadWebDavConfig)
  const [password, setPassword] = useState("")
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [saved, setSaved] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState("")

  const updateConfig = (patch: Partial<WebDavConfig>) => {
    setSaved(false)
    setConnectionError("")
    setConfig((current) => ({ ...current, ...patch }))
  }

  const persistConfig = () => {
    const normalized = normalizeConfig(config)
    saveWebDavConfig(normalized)
    setConfig(normalized)
    setSaved(true)
    onSaved()
    return normalized
  }

  const handleConnect = async () => {
    setConnecting(true)
    setConnectionError("")
    try {
      await onConnect(persistConfig(), password)
      onConnected()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接坚果云失败")
    } finally {
      setConnecting(false)
    }
  }

  const valid = config.serverUrl.startsWith("https://")
    && config.username.includes("@")
    && config.remotePath.startsWith("/")

  return (
    <div className="settings-content-card webdav-settings-form">
      <div className="settings-content-heading">
        <Server />
        <div><h2>坚果云 WebDAV</h2><p>配置远端 Obsidian Vault；当前只读取，不上传或修改文件。</p></div>
      </div>
      <div className="settings-form-grid">
        <div className="settings-field">
          <Label htmlFor="webdav-server">服务器地址</Label>
          <Input id="webdav-server" onChange={(event) => updateConfig({ serverUrl: event.target.value })} spellCheck={false} value={config.serverUrl} />
          {config.serverUrl !== JIANGUOYUN_WEBDAV_URL ? <button onClick={() => updateConfig({ serverUrl: JIANGUOYUN_WEBDAV_URL })} type="button">恢复坚果云默认地址</button> : null}
        </div>
        <div className="settings-field">
          <Label htmlFor="webdav-username">坚果云账号</Label>
          <Input autoComplete="username" id="webdav-username" onChange={(event) => updateConfig({ username: event.target.value })} spellCheck={false} type="email" value={config.username} />
        </div>
        <div className="settings-field">
          <div className="settings-field-label"><Label htmlFor="webdav-password">第三方应用密码</Label><a href="https://www.jianguoyun.com/d/account#safe" rel="noreferrer" target="_blank">去坚果云生成 <ExternalLink /></a></div>
          <div className="settings-password-field">
            <Input autoComplete="current-password" id="webdav-password" onChange={(event) => { setSaved(false); setConnectionError(""); setPassword(event.target.value) }} placeholder="由你输入，不保存" type={passwordVisible ? "text" : "password"} value={password} />
            <Button aria-label={passwordVisible ? "隐藏密码" : "显示密码"} onClick={() => setPasswordVisible((visible) => !visible)} size="icon-sm" type="button" variant="ghost">{passwordVisible ? <EyeOff /> : <Eye />}</Button>
          </div>
          <p className="settings-security-note"><KeyRound />密码仅保留在当前应用会话，关闭或刷新后需要重新输入。</p>
        </div>
        <div className="settings-field">
          <Label htmlFor="webdav-path">远端笔记目录</Label>
          <Input id="webdav-path" onChange={(event) => updateConfig({ remotePath: event.target.value })} placeholder="/SwellNote/" spellCheck={false} value={config.remotePath} />
          <p>程序会递归读取该目录下的 Markdown 文件。</p>
        </div>
      </div>
      {connectionError ? <div className="settings-form-error"><AlertCircle />{connectionError}</div> : null}
      <div className="settings-form-actions">
        {saved ? <span><Check />配置已保存</span> : null}
        <Button disabled={!valid || connecting} onClick={persistConfig} variant="outline">保存配置</Button>
        <Button disabled={!valid || password.length === 0 || connecting} onClick={() => void handleConnect()}>
          {connecting ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
          {connecting ? "正在读取…" : "连接并读取"}
        </Button>
      </div>
    </div>
  )
}

function normalizeConfig(config: WebDavConfig): WebDavConfig {
  const serverUrl = config.serverUrl.trim()
  const remotePath = config.remotePath.trim()
  const withLeadingSlash = remotePath.startsWith("/") ? remotePath : `/${remotePath}`
  return {
    ...config,
    remotePath: withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`,
    serverUrl: serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`,
  }
}
