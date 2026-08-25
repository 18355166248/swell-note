# Web 端部署

浏览器不能可靠地直接访问坚果云 WebDAV。生产环境必须把 `/api/webdav/*` 同源转发到
`https://dav.jianguoyun.com/dav/*`，并保留客户端传入的 `Authorization`、`Depth`、
`If-Match`、`Destination` 等 WebDAV 请求头。

构建时配置：

```bash
VITE_WEBDAV_PROXY_URL=/api/webdav pnpm build
```

反向代理必须满足以下约束：

- 上游地址固定为 `https://dav.jianguoyun.com/dav/`，禁止由请求参数指定任意目标，避免 SSRF。
- 全程 HTTPS，不记录 `Authorization`、正文和完整文件路径。
- 支持 `GET`、`PUT`、`DELETE`、`PROPFIND`、`MKCOL`、`MOVE`。
- 透传 `Depth`、`If-Match`、`If-None-Match`、`Destination` 与 `ETag`。
- 配置请求体大小和速率限制，当前客户端单个附件上限为 20MB。

如果生产构建没有设置 `VITE_WEBDAV_PROXY_URL`，应用会明确提示部署未配置，不会回退到
可能被 CORS 拦截的浏览器直连。

仓库提供了可直接调整域名与证书路径的 Nginx 示例：
[`deploy/nginx-swell-note.conf.example`](../deploy/nginx-swell-note.conf.example)。若使用其他网关，仍需配置等价的 CSP、`no-store` 和请求头透传规则。

## 真实并发自测

仓库中的普通测试不会连接或修改坚果云。需要验证真实 ETag 行为时，先准备专用测试目录，再显式执行：

```bash
SWELL_WEBDAV_E2E_USERNAME='账号' \
SWELL_WEBDAV_E2E_PASSWORD='第三方应用密码' \
SWELL_WEBDAV_E2E_VAULT_ROOT='/Swell/' \
pnpm test:webdav:live
```

测试只会在 Vault 根目录下的 `__swell_note_e2e__/` 创建一个唯一 Markdown 文件，模拟两台设备使用同一 ETag 写入，确认第二次过期写入被拒绝，并在结束时删除该文件。该测试必须手动执行，普通 `pnpm test` 不会访问云端。
