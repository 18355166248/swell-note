# Swell Note 发布说明

仓库使用 `.github/workflows/release.yml` 构建 macOS、Windows、Android 和 iOS 产物。

## 验证安装包

在 GitHub Actions 中手动运行 **Release installers**：

- macOS：Universal `.app` 和 `.dmg`，使用 ad-hoc 签名。
- Windows：x64 `.msi` 和 NSIS `.exe`。
- Android：arm64 debug `.apk`，可直接安装到测试设备。
- iOS：arm64 Simulator `.app`，只能安装到 Apple Silicon 模拟器。

手动运行不会创建 GitHub Release，也不要求发布证书。

## iOS 真机调试与安装

仓库同时支持 iOS 真机调试。首次使用：

1. 在 Xcode > Settings > Accounts 登录 Apple ID。
2. 用数据线连接并解锁 iPhone / iPad，在设备上信任此 Mac，并开启开发者模式。
3. 运行 `pnpm check:ios:device` 检查 Xcode、Rust target、CocoaPods、签名身份和设备状态。
4. 运行 `pnpm dev:ios:open`，在 Xcode 的 Signing & Capabilities 中为 `com.xmly.swell-note` 选择 Team，然后选择真机并点击 Run。
5. 首次签名完成后，运行 `pnpm ios` 使用现有图标构建 Release、覆盖安装并启动到默认真机 `Swell5`。Release 内置前端资源，安装后不依赖电脑开发服务。
6. 只有品牌图标源文件变化时才运行 `pnpm ios:refresh-icons`；普通安装不会重写图标和受版本控制的 iOS 构建配置。
7. 也可以在 Finder 双击 `安装到Swell5.command` 执行普通安装流程；覆盖安装会保留 App 本地数据。
8. 若需切换设备，运行 `pnpm ios -- --device "设备名称"`；只有需要热更新时才运行 `pnpm ios:dev`，调试版需要允许本地网络访问。

需要生成调试 IPA 时，运行：

```bash
APPLE_DEVELOPMENT_TEAM=你的TeamID pnpm build:ios:device
```

该命令使用 `debugging` 导出方式，只能安装到开发团队描述文件包含的设备。Team ID 和证书属于个人/团队凭据，不提交到仓库。真机开发服务器使用 Tauri 提供的 `TAURI_DEV_HOST`；项目的 Vite 配置已支持该变量。

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

## 发布前凭据检查

发布脚本只判断环境变量是否存在，不会输出凭据内容，也不会把凭据写入仓库。建议先执行：

```bash
# 日常检查：版本不一致会失败，缺少凭据只提示
pnpm release:check

# 正式发布机 / CI：任何平台缺少凭据都会失败
pnpm release:check -- --strict

# 只检查一个构建任务；名称区分大小写
pnpm release:check -- --strict --only=macOS
pnpm release:check -- --strict --only=Windows
pnpm release:check -- --strict --only=Android
pnpm release:check -- --strict --only=iOS
pnpm release:check -- --strict --only=updater
```

GitHub Actions 的标签发布会在导入证书之前调用同一检查脚本，各任务只读取自己所需的 Secrets。重点确认：

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 与生成更新私钥时使用的密码一致；错误或遗漏会导致安装包已经构建但更新签名失败。
- `APPLE_CERTIFICATE` 用于 macOS Developer ID，`IOS_CERTIFICATE` 用于 iOS Distribution，两者不要混用。
- `APPLE_PASSWORD` 应使用 Apple ID 的 App 专用密码，不是登录密码。
- Android、Apple、Windows 的 Base64 证书内容应保持单行；原始证书和私钥另行离线备份。
- 发布前用 `v<package.json version>` 创建标签，例如当前 `0.1.0` 对应 `v0.1.0`。
