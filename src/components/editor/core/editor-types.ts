// 编辑器核心的类型边界。这里只放与 UI 框架、表格 widget、实时预览无关的公共契约，
// 保证 core 层不反向依赖编辑器上层实现（依赖方向永远是 上层 → core）。

/**
 * 文档身份。异步链路（附件上传、剪贴板读取、远端回写）拿到结果时，
 * 必须靠它确认结果仍然属于发起时的那篇笔记。
 */
export type EditorDocumentIdentity = {
  /** 稳定笔记 ID。重命名会改 id，但会话内身份由 sessionKey 承担。 */
  noteId: string
  /**
   * 编辑会话 key（缓存库 + 会话标识）。撤销历史、选区与滚动快照都按它隔离；
   * 重命名期间 id 会短暂变化，sessionKey 不变，因此编辑器不必重建。
   */
  sessionKey: string
  /** 打开笔记时已知的远端 revision。异步回写前核对，undefined 表示尚未同步过。 */
  revision?: string
}

export type EditorPlatform = "desktop" | "mobile"

/**
 * 可动态重配置的设置。全部经 Compartment 生效：变化时只 reconfigure，
 * 不销毁 EditorView，因此焦点、输入法状态与 DOM 都不会被打断。
 */
export type EditorSettings = {
  /** 只读（锁定的阅读态、冲突待处理、同步中）。 */
  readOnly: boolean
  /** 平台模式。桌面与移动共享同一份扩展，只有键盘跟随、链接点按等分支不同。 */
  platform: EditorPlatform
  theme: "light" | "dark"
  /** 实时预览开关。默认开启，留给后续按需收敛。 */
  livePreview: boolean
  /** 表格编辑开关。关闭时表格只按源码编辑，不挂网格 widget。 */
  tableEditing: boolean
  /** 资源解析作用域（附件、图片缓存的命名空间），随笔记切换。 */
  assetScope?: string
  placeholder: string
}

export type EditorSelectionSnapshot = {
  anchor: number
  head: number
  /** 主选区头部所在行（1 基）。 */
  line: number
  /** 主选区头部所在列（1 基）。 */
  column: number
}

/**
 * 命令集合。只包含与 UI 实现无关的通用能力。
 *
 * 刻意只声明 core 里真能执行的命令：`dispatchCommand` 的返回类型是按命令派生的，
 * 若在这里列出尚无实现的命令，调用方会拿到「承诺返回 EditorFindResult，实际得到
 * undefined」的假类型，而这正是类型化命令入口要消灭的东西。
 *
 * 格式化、搜索与剪贴板命令依赖表格单元格、链接面板等 UI 现场，目前仍在
 * MarkdownEditorHandle 兼容层内实现（包括它们各自的返回值），后续阶段迁入时
 * 连同实现一起加回本联合类型。
 */
export type EditorCommand =
  | { type: "history.undo" }
  | { type: "history.redo" }
  | { type: "selection.all" }
  | { type: "selection.collapse" }
  | { type: "navigation.revealLine"; line: number }
  | { type: "navigation.scrollLineToTop"; line: number }

export type EditorCommandType = EditorCommand["type"]

/** 每条命令的返回类型。与 EditorCommand 必须严格一一对应。 */
export type EditorCommandResult = {
  "history.undo": void
  "history.redo": void
  "selection.all": void
  "selection.collapse": void
  "navigation.revealLine": void
  "navigation.scrollLineToTop": boolean
}
