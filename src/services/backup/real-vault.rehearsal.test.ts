import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { it, expect } from "vitest"

import { collectBackupInventory } from "./backup-inventory"
import { createVaultBackup, parseVaultBackup } from "./vault-backup"
import { inspectVaultRestore } from "./vault-restore-preview"

const sourceRoot = process.env.SWELL_BACKUP_VERIFY_SOURCE
const issueReportPath = process.env.SWELL_BACKUP_VERIFY_REPORT
const ignoredDirectories = new Set([".git", ".obsidian", ".swell", ".swell-trash", "node_modules"])

async function listVaultFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) paths.push(...await listVaultFiles(root, next))
    else if (entry.isFile()) paths.push(next)
  }
  return paths.sort()
}

async function listVaultNotes(root: string) {
  return (await listVaultFiles(root)).filter((relative) => /\.(?:md|canvas)$/i.test(relative))
}

function sourcePath(root: string, relative: string) {
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("附件路径越过笔记库边界")
  return absolute
}

function hash(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex")
}

it.skipIf(!sourceRoot)("真实笔记库备份、空目录恢复与逐文件哈希校验", async () => {
  const root = path.resolve(sourceRoot!)
  const allPaths = await listVaultFiles(root)
  const notePaths = allPaths.filter((relative) => /\.(?:md|canvas)$/i.test(relative))
  expect(notePaths.length).toBeGreaterThan(0)
  const inventory = await collectBackupInventory({
    cachedAttachments: [],
    loadAttachment: async (relative) => ({ data: new Uint8Array(await readFile(sourcePath(root, relative))) }),
    loadNote: async (note) => readFile(sourcePath(root, note.storagePath), "utf8"),
    notes: notePaths.map((relative) => ({ id: relative, path: relative, storagePath: relative })),
    toBackupPath: (relative) => relative,
  })
  const issueKinds = inventory.issues.reduce<Record<string, number>>((counts, issue) => {
    const extension = issue.path.split(".").pop()?.toLocaleLowerCase().split(/[?#]/, 1)[0] ?? "unknown"
    const key = `${issue.kind}:${extension}:${issue.reason.includes("ENOENT") ? "missing" : "other"}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  const alternateLocations = inventory.issues.reduce<Record<string, number>>((counts, issue) => {
    const matches = allPaths.filter((relative) => path.basename(relative).toLocaleLowerCase() === path.basename(issue.path).toLocaleLowerCase())
    const key = matches.length === 0 ? "no-match" : matches.length > 1 ? "ambiguous" : matches[0].startsWith("attachments/") ? "attachments" : matches[0].includes("/") ? "other-folder" : "root"
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  if (issueReportPath) {
    // 逐项路径可能含私人信息，只写到调用者指定的本机文件，不进入测试日志或仓库。
    const issues = inventory.issues.map((issue) => ({
      ...issue,
      sameNamePaths: allPaths.filter((relative) => path.basename(relative).toLocaleLowerCase() === path.basename(issue.path).toLocaleLowerCase()),
    }))
    await writeFile(issueReportPath, JSON.stringify({ sourceRoot: root, issues }, null, 2), { flag: "wx" })
  }
  expect(inventory.notes).toHaveLength(notePaths.length)

  const bytes = createVaultBackup({ attachments: inventory.attachments, label: "真实笔记库演练", notes: inventory.notes })
  const backup = parseVaultBackup(bytes)
  expect(backup.integrityWarnings).toEqual([])
  expect(backup.manifest.noteCount).toBe(notePaths.length)
  expect(backup.manifest.attachmentCount).toBe(inventory.attachments.length)
  expect(inspectVaultRestore({ backup, cacheId: "rehearsal", existingPaths: [], fileName: "rehearsal.swell.zip", resolveStoragePath: (value) => value, sourceKind: "local" }).existingNotePaths).toEqual([])

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "swell-note-backup-rehearsal-"))
  try {
    const expected = new Map<string, string>()
    for (const relative of notePaths) expected.set(relative, hash(await readFile(sourcePath(root, relative))))
    for (const attachment of inventory.attachments) expected.set(attachment.path, hash(await readFile(sourcePath(root, attachment.path))))

    // 仅向新建的空目录写恢复结果，逐个使用独占创建，绝不触及来源笔记库。
    for (const note of backup.notes) {
      const destination = sourcePath(temporaryRoot, note.path)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, note.content, { flag: "wx" })
    }
    for (const attachment of backup.attachments) {
      const destination = sourcePath(temporaryRoot, attachment.path)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, attachment.data, { flag: "wx" })
    }
    const restoredPaths = [...await listVaultNotes(temporaryRoot), ...backup.attachments.map((entry) => entry.path)].sort()
    expect(restoredPaths).toEqual([...expected.keys()].sort())
    for (const [relative, originalHash] of expected) {
      expect(hash(await readFile(sourcePath(temporaryRoot, relative))), `恢复文件哈希不同：${relative}`).toBe(originalHash)
    }
    console.log(`恢复校验：${backup.notes.length} 篇笔记、${backup.attachments.length} 个可读取的引用附件、${bytes.byteLength} 字节 ZIP；逐文件 SHA-256 一致`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  // 即使已验证可读取文件的归档往返，引用缺失仍是完整备份的发布阻断项。
  expect(inventory.issues.length, `完整备份未通过：${JSON.stringify(issueKinds)}；同名文件位置：${JSON.stringify(alternateLocations)}`).toBe(0)
})
