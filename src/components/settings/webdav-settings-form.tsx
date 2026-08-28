import { useEffect, useState, type FormEvent } from "react"
import { AlertCircle, Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Server, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  JIANGUOYUN_WEBDAV_URL,
  loadWebDavConfig,
  saveWebDavConfig,
  type WebDavConfig,
} from "@/lib/webdav-config"
import {
  deleteWebDavPassword,
  getCredentialStoreStatus,
  loadWebDavPassword,
  saveWebDavPassword,
  type CredentialStoreStatus,
} from "@/services/security/credential-store"

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
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [saved, setSaved] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState("")
  const [securityMessage, setSecurityMessage] = useState("")
  const [credentialStatus, setCredentialStatus] = useState<CredentialStoreStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCredentialStoreStatus().then((status) => {
      if (cancelled) return
      setCredentialStatus(status)
      // 原生端把安全保存作为默认能力，兼容升级前 rememberPassword=false 的旧配置。
      if (status.available) setConfig((current) => ({ ...current, rememberPassword: true }))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!credentialStatus?.available || !config.username || passwordTouched) return
    let cancelled = false
    // 仅原生安装版读取系统凭据；读取失败保留空密码，让用户仍可手动连接。
    void loadWebDavPassword(config)
      .then((storedPassword) => {
        if (!cancelled && storedPassword) setPassword(storedPassword)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [config.rememberPassword, config.username, credentialStatus?.available, passwordTouched])

  const updateConfig = (patch: Partial<WebDavConfig>) => {
    setSaved(false)
    setConnectionError("")
    setConfig((current) => ({ ...current, ...patch }))
  }

  const persistConfig = () => {
    const normalized = normalizeConfig({
      ...config,
      rememberPassword: credentialStatus?.available === true,
    })
    saveWebDavConfig(normalized)
    setConfig(normalized)
    setSaved(true)
    onSaved()
    return normalized
  }

  const handleConnect = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setConnecting(true)
    setConnectionError("")
    setSecurityMessage("")
    try {
      const normalized = persistConfig()
      await onConnect(normalized, password)
      try {
        if (normalized.rememberPassword) {
          await saveWebDavPassword(normalized, password)
          setSecurityMessage(`密码已保存到 ${credentialStatus?.store ?? "系统安全存储"}`)
        } else {
          await deleteWebDavPassword(normalized)
        }
      } catch {
        // WebDAV 已连接成功时，系统凭据写入失败只做提示，不能把连接误报为失败。
        setSecurityMessage("坚果云已连接，但系统未能保存密码；下次需要重新输入")
      }
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
    <form className="settings-content-card webdav-settings-form" onSubmit={(event) => void handleConnect(event)}>
      <div className="settings-content-heading">
        <Server />
        <div><h2>坚果云 WebDAV</h2><p>本地优先编辑；只有点击同步后，才会安全写入远端笔记。</p></div>
      </div>
      <div className="settings-form-grid">
        <div className="settings-field">
          <Label htmlFor="webdav-server">服务器地址</Label>
          <Input id="webdav-server" onChange={(event) => updateConfig({ serverUrl: event.target.value })} spellCheck={false} value={config.serverUrl} />
          {config.serverUrl !== JIANGUOYUN_WEBDAV_URL ? <button onClick={() => updateConfig({ serverUrl: JIANGUOYUN_WEBDAV_URL })} type="button">恢复坚果云默认地址</button> : null}
        </div>
        <div className="settings-field">
          <Label htmlFor="webdav-username">坚果云账号</Label>
          <Input autoComplete="username" id="webdav-username" name="username" onChange={(event) => {
            setPassword("")
            setPasswordTouched(false)
            updateConfig({ username: event.target.value })
          }} spellCheck={false} type="email" value={config.username} />
        </div>
        <div className="settings-field">
          <div className="settings-field-label"><Label htmlFor="webdav-password">第三方应用密码</Label><a href="https://www.jianguoyun.com/d/account#safe" rel="noreferrer" target="_blank">去坚果云生成 <ExternalLink /></a></div>
          <div className="settings-password-field">
            <Input autoComplete="current-password" id="webdav-password" name="password" onChange={(event) => { setSaved(false); setConnectionError(""); setPasswordTouched(true); setPassword(event.target.value) }} placeholder="可由密码管理器自动填充" type={passwordVisible ? "text" : "password"} value={password} />
            <Button aria-label={passwordVisible ? "隐藏密码" : "显示密码"} onClick={() => setPasswordVisible((visible) => !visible)} size="icon-sm" type="button" variant="ghost">{passwordVisible ? <EyeOff /> : <Eye />}</Button>
          </div>
          {credentialStatus?.native && credentialStatus.available ? (
            <div className="settings-secure-password-default">
              <ShieldCheck />
              <span><strong>首次连接后自动记住</strong><small>应用密码保存在 {credentialStatus.store}；只有密码失效或更换后才需要重新输入。</small></span>
            </div>
          ) : (
            <p className="settings-security-note"><KeyRound />{credentialStatus?.native
              ? "系统安全存储暂不可用，密码仅用于当前会话。"
              : "Web 端密码仅用于当前会话，刷新或关闭后需要重新输入。"}</p>
          )}
        </div>
        <div className="settings-field">
          <Label htmlFor="webdav-path">远端笔记目录</Label>
          <Input id="webdav-path" onChange={(event) => updateConfig({ remotePath: event.target.value })} placeholder="/SwellNote/" spellCheck={false} value={config.remotePath} />
          <p>程序会递归读取该目录下的 Markdown 文件。</p>
        </div>
      </div>
      {connectionError ? <div className="settings-form-error"><AlertCircle />{connectionError}</div> : null}
      {securityMessage ? <div className="settings-security-result"><ShieldCheck />{securityMessage}</div> : null}
      <div className="settings-form-actions">
        {saved ? <span><Check />配置已保存</span> : null}
        <Button disabled={!valid || connecting} onClick={persistConfig} type="button" variant="outline">保存配置</Button>
        <Button disabled={!valid || password.length === 0 || connecting} type="submit">
          {connecting ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
          {connecting ? "正在同步…" : "连接并同步"}
        </Button>
      </div>
    </form>
  )
}

function normalizeConfig(config: WebDavConfig): WebDavConfig {
  const serverUrl = config.serverUrl.trim()
  const remotePath = config.remotePath.trim()
  const withLeadingSlash = remotePath.startsWith("/") ? remotePath : `/${remotePath}`
  return {
    ...config,
    rememberPassword: config.rememberPassword === true,
    remotePath: withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`,
    serverUrl: serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`,
  }
}
