// 图片与附件插入的实际界面验证：驱动复现页（生产 MarkdownEditor + FormattingToolbar），
// 附件写入用页面内置的内存替身（可控延迟/失败），不触达真实笔记库。
// 运行：node docs/editor-audit-2026-09-10/verify-image-insertion.mjs
// 本机 playwright 1.62.1 期望的浏览器构建未下载，复用缓存中的 chromium-1223。
import { homedir } from "node:os"
import { chromium } from "@playwright/test"

const URL = "http://127.0.0.1:4187/docs/editor-audit-2026-09-10/index.html"

const results = []
function report(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
}

const browser = await chromium.launch({ executablePath: `${homedir()}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` })
const page = await browser.newPage()
page.on("pageerror", (error) => console.error("页面异常:", error.message))

async function loadSample(text) {
  await page.getByLabel("样本源码").fill(text)
  await page.getByRole("button", { name: "载入样本" }).click()
}
async function source() {
  return (await page.locator('pre[aria-label="实际源码"]').textContent()) ?? ""
}
async function setDelay(ms) {
  await page.getByLabel("延迟毫秒").fill(String(ms))
}
// 复现页把 EditorView 暴露在 window.__auditView()，用于设置选区与读取光标。
async function setSelection(anchor, head = anchor) {
  await page.evaluate(([a, h]) => {
    const view = window.__auditView()
    view.dispatch({ selection: { anchor: a, head: h } })
    view.focus()
  }, [anchor, head])
}
async function cursor() {
  return page.evaluate(() => {
    const view = window.__auditView()
    return { empty: view.state.selection.main.empty, head: view.state.selection.main.head, hasFocus: view.hasFocus }
  })
}

await page.goto(URL, { waitUntil: "networkidle" })
await page.locator(".cm-content").waitFor()

// V1 有选区插图：选中「乙丙」后插入，选中文字必须保留，图片落在选区起点。
await loadSample("甲乙丙丁")
await setSelection(1, 3)
await page.getByRole("button", { name: "插入一张测试图" }).click()
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("测试图"))
{
  const actual = await source()
  report("V1 有选区插图不删选中文字", actual === "甲![测试图1](attachments/fake-1.png)\n乙丙丁", actual)
}

// V2 等待期间在插入点之前输入：书签随事务映射，图片仍落在原目标处。
await loadSample("开头 目标 结尾")
await setSelection(6) // 光标在「目标 」之后、「结尾」之前
await setDelay(1200)
await page.getByRole("button", { name: "插入一张测试图" }).click()
await page.locator(".cm-content").click()
await page.keyboard.press("Home")
await page.keyboard.type("更长的")
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("测试图"), null, { timeout: 5000 })
{
  const actual = await source()
  report("V2 插入点之前输入后书签正确映射", actual === "更长的开头 目标 ![测试图1](attachments/fake-1.png)\n结尾", actual)
}

// V3 等待期间把光标移到别处继续写作：完成后不打断当前光标位置。
await loadSample("第一段 目标\n\n第二段")
await setSelection(6) // 「目标」之后（行尾）
await setDelay(1000)
await page.getByRole("button", { name: "插入一张测试图" }).click()
await setSelection(9) // 「第二段」的「二」之前
await page.keyboard.type("写作")
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("测试图"), null, { timeout: 5000 })
{
  const actual = await source()
  const pos = await cursor()
  const expected = "第一段 目标![测试图1](attachments/fake-1.png)\n\n\n第写作二段"
  const expectHead = expected.indexOf("写作") + 2
  report("V3 移动光标继续写作不被打断", actual === expected && pos.head === expectHead, `${actual} | head=${pos.head} 期望 ${expectHead}`)
}

// V4 两张图一次插入 = 一步撤销、一步重做。
await loadSample("正文")
await setSelection(2)
await setDelay(300)
await page.getByRole("button", { name: "插入两张测试图" }).click()
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("fake-2"), null, { timeout: 5000 })
await page.getByRole("button", { name: /撤销/ }).click()
{
  const afterUndo = await source()
  await page.getByRole("button", { name: /重做/ }).click()
  const afterRedo = await source()
  report(
    "V4 多图插入一步撤销/重做",
    afterUndo === "正文" && afterRedo === "正文![测试图1](attachments/fake-1.png)\n\n![测试图2](attachments/fake-2.png)\n",
    `undo=${JSON.stringify(afterUndo)} redo=${JSON.stringify(afterRedo)}`,
  )
}

// V5 写入中再次插入：并发守卫拦截并给出提示，绝不重复插入。
await loadSample("正文")
await setSelection(2)
await setDelay(1500)
await page.getByRole("button", { name: "插入一张测试图" }).click()
await page.getByRole("button", { name: "插入两张测试图" }).click({ force: true }).catch(() => {})
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("测试图"), null, { timeout: 5000 })
await page.waitForTimeout(200) // 等可能的第二批迟到回调
{
  const actual = await source()
  const occurrences = (actual.match(/测试图/g) ?? []).length
  const error = await page.locator('p[aria-label="附件错误"]').textContent().catch(() => null)
  report(
    "V5 写入中不重复插入且有提示",
    occurrences === 1 && (error?.includes("上一批附件仍在写入") || error === null),
    `${occurrences} 处引用 | 提示=${error}`,
  )
}

// V6 写入失败：正文零改动并给出错误提示。
await loadSample("正文")
await setSelection(2)
await page.getByLabel("模拟失败").check()
await page.getByRole("button", { name: "插入一张测试图" }).click()
await page.waitForSelector('p[aria-label="附件错误"]', { timeout: 5000 })
{
  const actual = await source()
  const error = await page.locator('p[aria-label="附件错误"]').textContent()
  report("V6 写入失败不动正文且有提示", actual === "正文" && error?.includes("模拟写入失败"), `${actual} | ${error}`)
  await page.getByLabel("模拟失败").uncheck()
}

// V7 表格单元格编辑中插图：先提交单元格，图片落在表格之后且不破坏表格结构。
await loadSample("| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n\n后续正文")
await setDelay(300) // 先设延迟：进单元格后不能再碰其他输入框，否则单元格先失焦提交
await page.locator(".cm-md-table-wrap td").first().click()
await page.waitForSelector(".cm-md-table-cell-input")
await page.getByRole("button", { name: "插入一张测试图" }).click()
await page.waitForFunction(() => document.querySelector('pre[aria-label="实际源码"]').textContent.includes("测试图"), null, { timeout: 5000 })
{
  const actual = await source()
  // 图片与表格之间补出空行（不被并进表格）；原有空行保留，结构完整。
  const expected = "| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n\n![测试图1](attachments/fake-1.png)\n\n\n后续正文"
  report("V7 单元格编辑中插图落在表格之后", actual === expected, actual)
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await browser.close()
process.exit(failed.length ? 1 : 0)
