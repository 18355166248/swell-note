# Swell Note 发布说明

仓库使用 `.github/workflows/release.yml` 构建 macOS、Windows、Android 和 iOS 产物。

## 验证安装包

在 GitHub Actions 中手动运行 **Release installers**：

- macOS：Universal `.app` 和 `.dmg`，使用 ad-hoc 签名。
- Windows：x64 `.msi` 和 NSIS `.exe`。
- Android：arm64 debug `.apk`，可直接安装到测试设备。
- iOS：arm64 Simulator `.app`，只能安装到 Apple Silicon 模拟器。

手动运行不会创建 GitHub Release，也不要求发布证书。

## 正式发布

1. 同时更新 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 的版本。
2. 配置下述 GitHub Actions Secrets。
3. 推送同版本标签，例如 `v0.2.0`。
4. 工作流校验三个版本号，构建各平台安装包并自动创建 GitHub Release。

Android 发布 Secrets：

- `ANDROID_KEY_BASE64`：上传证书 JKS 的 Base64 内容。
- `ANDROID_KEY_ALIAS`：证书别名。
- `ANDROID_KEY_PASSWORD`：证书和 keystore 密码。

iOS 发布 Secrets：

- `IOS_CERTIFICATE`：Apple Distribution `.p12` 的 Base64 内容。
- `IOS_CERTIFICATE_PASSWORD`：证书导出密码。
- `IOS_MOBILE_PROVISION`：App Store Connect provisioning profile 的 Base64 内容。

Android 和 iOS 在标签发布时会强制检查并导入发布证书，缺失则明确失败，避免发布调试包。手动验证任务中的 macOS 包采用 ad-hoc 签名；正式标签发布要求 Developer ID 签名和公证凭据。Windows 正式标签同样要求代码签名证书，避免公开安装包触发未签名警告。

桌面自动更新与正式签名还需要以下 Secrets：

- `TAURI_UPDATER_PUBLIC_KEY`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：Tauri 更新签名密钥。私钥必须另行安全备份，丢失后已安装客户端无法继续验证新版本。
- macOS：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`。标签发布会进行 Developer ID 签名和公证。
- Windows：`WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`、`WINDOWS_CERTIFICATE_THUMBPRINT`。标签发布会导入证书并签名安装包。

标签工作流会生成只在 CI 使用的 `tauri.release.conf.json` 和更新签名产物；普通本地构建不需要私钥，也不会伪装成可自动更新的正式安装包。更新元数据由 GitHub Release 的 `latest.json` 提供。

发布前可运行 `pnpm release:check` 检查四处版本号和各平台凭据名称；在 CI 或安全的本机环境中追加 `-- --strict` 可让缺少任一正式凭据时返回失败。脚本只判断凭据是否存在，不会输出凭据内容。
