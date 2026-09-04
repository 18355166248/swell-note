import { useEffect, useState, type FormEvent } from "react"
import { AlertCircle, Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw } from "lucide-react"

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
import { isIndexedDbConnectionLostError } from "@/services/cache/vault-cache"
import { getCredentialStoreStatus } from "@/services/security/credential-store"

export function QuickWebDavConnectDialog({
  account,
  onConnect,
  onOpenChange,
  open,
}: {
  account: string
  onConnect: (password: string) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [password, setPassword] = useState("")
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState("")
  const [databaseConnectionLost, setDatabaseConnectionLost] = useState(false)
  const [secureStoreName, setSecureStoreName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCredentialStoreStatus().then((status) => {
      if (!cancelled) setSecureStoreName(status.available ? status.store : null)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (open) {
      setConnectionError("")
      setDatabaseConnectionLost(false)
    } else {
      // 密码只活在弹窗生命周期内；关闭后立即清空，避免进入缓存或跨页面残留。
      setPassword("")
      setPasswordVisible(false)
    }
  }, [open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password || connecting) return
    setConnecting(true)
    setConnectionError("")
    try {
      await onConnect(password)
      onOpenChange(false)
    } catch (error) {
      if (isIndexedDbConnectionLostError(error)) {
        // 本地数据库断连时重试无意义，引导用户刷新重建连接。
        setDatabaseConnectionLost(true)
      } else {
        setConnectionError(error instanceof Error ? error.message : "重新连接坚果云失败")
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog onOpenChange={(nextOpen) => !connecting && onOpenChange(nextOpen)} open={open}>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>快速连接坚果云</DialogTitle>
            <DialogDescription>
              {secureStoreName
                ? `输入一次应用密码；连接成功后会安全保存到 ${secureStoreName}，以后自动使用。`
                : "输入应用密码后会留在当前页面，并立即同步待上传笔记。"}
            </DialogDescription>
          </DialogHeader>

          <div className="quick-connect-fields">
            <div className="settings-field">
              <Label htmlFor="quick-webdav-username">坚果云账号</Label>
              <Input autoComplete="username" id="quick-webdav-username" name="username" readOnly value={account} />
            </div>
            <div className="settings-field">
              <Label htmlFor="quick-webdav-password">第三方应用密码</Label>
              <div className="settings-password-field">
                <Input
                  autoComplete="current-password"
                  autoFocus
                  id="quick-webdav-password"
                  name="password"
                  onChange={(event) => {
                    setConnectionError("")
                    setPassword(event.target.value)
                  }}
                  placeholder="可由密码管理器自动填充"
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                />
                <Button
                  aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {passwordVisible ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <p className="settings-security-note"><KeyRound />{secureStoreName
                ? "密码只进入系统安全存储，不会写入笔记缓存。"
                : "密码不会写入 Swell Note 本地缓存。"}</p>
            </div>
            {databaseConnectionLost ? (
              <div className="settings-form-error">
                <AlertCircle />
                <span className="flex flex-col items-start gap-2">
                  本地数据库连接已被系统中断（应用退到后台后被回收），刷新页面即可恢复；尚未保存的修改会丢失。
                  <Button onClick={() => window.location.reload()} size="sm" type="button" variant="outline">
                    <RefreshCw />刷新页面
                  </Button>
                </span>
              </div>
            ) : connectionError ? <div className="settings-form-error"><AlertCircle />{connectionError}</div> : null}
          </div>

          <DialogFooter>
            <Button disabled={connecting} onClick={() => onOpenChange(false)} type="button" variant="outline">取消</Button>
            <Button disabled={!password || connecting} type="submit">
              {connecting ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
              {connecting ? "正在同步…" : "连接并同步"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
