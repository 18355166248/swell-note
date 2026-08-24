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

Android 和 iOS 在标签发布时会强制检查证书，缺失则明确失败，避免发布调试包。macOS 当前采用 ad-hoc 签名，用户首次打开仍可能需要在“隐私与安全性”中确认；要消除此提示并完成公证，需要后续配置 Apple Developer ID 和公证凭据。Windows 未配置代码签名证书时可能触发 SmartScreen，正式面向公众分发前应补充 Windows 签名。
