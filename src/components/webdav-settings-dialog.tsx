import { useState } from "react"
import { AlertCircle, Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  JIANGUOYUN_WEBDAV_URL,
  loadWebDavConfig,
  saveWebDavConfig,
  type WebDavConfig,
} from "@/lib/webdav-config"

type WebDavSettingsDialogProps = {
  onConnect: (config: WebDavConfig, password: string) => Promise<number>
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  open: boolean
}

export function WebDavSettingsDialog({
  onConnect,
  onOpenChange,
  onSaved,
  open,
}: WebDavSettingsDialogProps) {
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

  const handleSave = () => {
    saveWebDavConfig(normalizeConfig(config))
    setSaved(true)
    onSaved()
  }

  const handleConnect = async () => {
    const normalizedConfig = normalizeConfig(config)
    setConnecting(true)
    setConnectionError("")

    try {
      saveWebDavConfig(normalizedConfig)
      await onConnect(normalizedConfig, password)
      setConfig(normalizedConfig)
      setSaved(true)
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接坚果云失败")
    } finally {
      setConnecting(false)
    }
  }

  const valid =
    config.serverUrl.startsWith("https://") &&
    config.username.includes("@") &&
    config.remotePath.startsWith("/")

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Server className="size-5" />
          </div>
          <DialogTitle>坚果云 WebDAV</DialogTitle>
          <DialogDescription>
            配置 Swell Note 的远端笔记目录。请使用坚果云第三方应用密码，不要填写账号登录密码。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="webdav-server">服务器地址</Label>
            <Input
              autoCapitalize="none"
              id="webdav-server"
              onChange={(event) => updateConfig({ serverUrl: event.target.value })}
              spellCheck={false}
              value={config.serverUrl}
            />
            {config.serverUrl !== JIANGUOYUN_WEBDAV_URL ? (
              <button
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => updateConfig({ serverUrl: JIANGUOYUN_WEBDAV_URL })}
                type="button"
              >
                恢复坚果云默认地址
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="webdav-username">坚果云账号</Label>
            <Input
              autoCapitalize="none"
              autoComplete="username"
              id="webdav-username"
              onChange={(event) => updateConfig({ username: event.target.value })}
              spellCheck={false}
              type="email"
              value={config.username}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="webdav-password">第三方应用密码</Label>
              <a
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href="https://www.jianguoyun.com/d/account#safe"
                rel="noreferrer"
                target="_blank"
              >
                去坚果云生成
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="relative">
              <Input
                autoComplete="current-password"
                className="pr-9"
                id="webdav-password"
                onChange={(event) => {
                  setSaved(false)
                  setConnectionError("")
                  setPassword(event.target.value)
                }}
                placeholder="由你输入，不写入源码"
                type={passwordVisible ? "text" : "password"}
                value={password}
              />
              <Button
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                className="absolute right-0.5 top-0.5"
                onClick={() => setPasswordVisible((visible) => !visible)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {passwordVisible ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" />
              当前密码只保留在本次应用会话中。原生安全存储接入前，关闭应用后需要重新输入。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webdav-path">远端笔记目录</Label>
            <Input
              autoCapitalize="none"
              id="webdav-path"
              onChange={(event) => updateConfig({ remotePath: event.target.value })}
              placeholder="/SwellNote/"
              spellCheck={false}
              value={config.remotePath}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              填写现有 Obsidian Vault 在坚果云中的目录。程序会递归读取该目录下的 Markdown。
            </p>
            {config.remotePath !== "/" ? (
              <button
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => updateConfig({ remotePath: "/" })}
                type="button"
              >
                从坚果云根目录读取
              </button>
            ) : null}
          </div>

          {connectionError ? (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{connectionError}</span>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              “连接并读取”会向坚果云验证凭据、扫描远端目录，并将云端 Markdown 加载到笔记列表。当前为只读模式，不会上传或修改坚果云文件。
            </div>
          )}
        </div>

        <DialogFooter>
          {saved ? (
            <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-emerald-600">
              <Check className="size-3.5" />
              配置已保存
            </span>
          ) : null}
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={!valid || connecting} onClick={handleSave} type="button" variant="outline">
            保存配置
          </Button>
          <Button disabled={!valid || password.length === 0 || connecting} onClick={handleConnect} type="button">
            {connecting ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            {connecting ? "正在读取…" : "连接并读取"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function normalizeServerUrl(serverUrl: string) {
  const trimmedUrl = serverUrl.trim()
  return trimmedUrl.endsWith("/") ? trimmedUrl : `${trimmedUrl}/`
}

function normalizeRemotePath(remotePath: string) {
  const trimmedPath = remotePath.trim()
  const withLeadingSlash = trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`
}

function normalizeConfig(config: WebDavConfig): WebDavConfig {
  return {
    ...config,
    serverUrl: normalizeServerUrl(config.serverUrl),
    remotePath: normalizeRemotePath(config.remotePath),
  }
}
