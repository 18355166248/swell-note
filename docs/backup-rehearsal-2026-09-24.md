# 真实笔记库备份恢复演练（2026-09-24）

## 范围与方法

- 来源：共享工作区中含 `.obsidian` 的本地笔记库；只读扫描，按本地适配器的规则忽略 `.git`、`.obsidian`、`.swell`、`.swell-trash` 和 `node_modules`。
- 使用应用的 `collectBackupInventory`、`createVaultBackup`、`parseVaultBackup` 与恢复预览函数。把解析后的笔记和可读取附件写入新建的临时空目录，再逐文件对比来源与恢复结果的 SHA-256；测试结束删除临时目录。
- 这项验证覆盖备份清单、ZIP 编解码和文件字节往返。它没有通过应用界面或 Tauri 文件适配器执行真实写入，也不覆盖未被笔记引用、未进入附件缓存的其他文件。
- 另以浏览器回归的合成备份验证了桌面端“恢复前预览→确认后写入”流程；移动端此用例按现有测试配置跳过。该回归不能代替真实笔记库的界面恢复验收。

## 结果

| 检查项 | 结果 |
| --- | --- |
| 笔记扫描 | 88 篇 Markdown/Canvas |
| 可读取的引用附件 | 1 个 |
| 可读取文件的 ZIP 往返与哈希 | 88 篇笔记和 1 个附件全部一致；本次临时 ZIP 为 285347 字节 |
| 完整性门槛 | **未通过**：9 个附件引用无法按当前路径读取；其中 6 个在扫描范围内找不到同名文件，3 个同名文件位于笔记库根目录而非引用的相对位置 |

因此，当前来源库在应用的完整性规则下会被阻止生成整库备份。临时 ZIP 仅用于验证可读取文件的往返，**不能作为完整备份使用**；未保留 ZIP 或恢复目录。原笔记库没有被写入。

逐项引用路径和同名候选位置保存在共享工作区的本机报告 `backup-rehearsal-issues-2026-09-24.json`，不提交到代码仓库。修正引用或补回附件后，重新运行以下验收，直到完整性门槛通过：

```sh
SWELL_BACKUP_VERIFY_SOURCE=/path/to/vault pnpm exec vitest run src/services/backup/real-vault.rehearsal.test.ts
```

若需要逐项路径报告，可额外设置 `SWELL_BACKUP_VERIFY_REPORT=/path/to/new-report.json`；目标文件必须不存在，以免覆盖旧报告。
