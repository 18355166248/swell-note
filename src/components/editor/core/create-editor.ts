import { Compartment, EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view"
import { indentWithTab } from "@codemirror/commands"
import { basicSetup, defaultLightThemeOption, oneDark } from "@uiw/react-codemirror"

import type { EditorSettings } from "./editor-types"

/**
 * 动态配置的载体。会变化的设置一律挂这里，经 reconfigure 生效，
 * EditorView 本身始终存活——这是「配置变化不重建编辑器」的落点。
 */
export type EditorCompartments = {
  editable: Compartment
  theme: Compartment
  platform: Compartment
  livePreview: Compartment
  tableEditing: Compartment
}

export function createEditorCompartments(): EditorCompartments {
  return {
    editable: new Compartment(),
    theme: new Compartment(),
    platform: new Compartment(),
    livePreview: new Compartment(),
    tableEditing: new Compartment(),
  }
}

/** 上层注入扩展时拿到的上下文。core 只提供这些，不反向依赖任何上层实现。 */
export type EditorExtensionContext = {
  compartments: EditorCompartments
  settings: EditorSettings
}

/** 上层提供的扩展工厂。同样的 settings 必须得到同样的扩展。 */
export type EditorExtensionFactory = (context: EditorExtensionContext) => Extension

// 与 @uiw/react-codemirror 的默认行为保持一致：关掉 gutter、行号与活动行高亮，
// 括号匹配、自动闭合、历史、自动补全等一律保留。
export const EDITOR_BASIC_SETUP = {
  bracketMatching: true,
  closeBrackets: true,
  drawSelection: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  lineNumbers: false,
} as const

// 原实现通过 <CodeMirror height="100%"> 注入：外层 div 撑满，内部 scroller 强制 100%。
// 换成自建 EditorView 后这两条要显式补上，否则 .markdown-editor-shell 的高度链会断。
const editorDimensionTheme = EditorView.theme({ "&": { height: "100%" } })
const editorScrollerTheme = EditorView.theme({ "& .cm-scroller": { height: "100% !important" } })

/** 只读与可编辑必须同时切换：前者拦命令，后者拦 DOM 层的输入。 */
export function editableExtension(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ]
}

export function themeExtension(theme: EditorSettings["theme"]): Extension {
  return theme === "dark" ? oneDark : defaultLightThemeOption
}

export type EditorStateOptions = {
  doc: string
  initialState?: { json: unknown; fields: Record<string, unknown> }
  settings: EditorSettings
  compartments: EditorCompartments
  /** 语言扩展：必须排在装饰与行为扩展之前。 */
  languageExtensions: Extension
  /** 行为扩展：输入增强、选区渲染、滚动处理、事件转发。 */
  behaviorExtensions: Extension
  platformExtensions: EditorExtensionFactory
  livePreviewExtensions: EditorExtensionFactory
  tableEditingExtensions: EditorExtensionFactory
}

/**
 * 组装编辑器状态。初始化与「按笔记重建状态」共用这一份逻辑，
 * 避免两条路径的扩展顺序漂移——顺序会直接影响主题覆盖与 keymap 优先级。
 *
 * 顺序刻意与原 @uiw/react-codemirror 组合结果对齐：
 * basicSetup 在主题之前（否则主题会被 basicSetup 的默认规则盖住）。
 */
export function buildEditorState(options: EditorStateOptions): EditorState {
  const context: EditorExtensionContext = {
    compartments: options.compartments,
    settings: options.settings,
  }
  const extensions: Extension = [
    options.languageExtensions,
    // 实时预览与表格编辑按原 markdownLivePreview 的位置注册，装饰层级不变。
    options.compartments.livePreview.of(options.livePreviewExtensions(context)),
    options.compartments.tableEditing.of(options.tableEditingExtensions(context)),
    options.behaviorExtensions,
    placeholderExtension(options.settings.placeholder),
    basicSetup(EDITOR_BASIC_SETUP),
    keymap.of([indentWithTab]),
    editorDimensionTheme,
    editorScrollerTheme,
    // 主题与只读排在 basicSetup 之后，与改造前一致。
    options.compartments.editable.of(editableExtension(options.settings.readOnly)),
    options.compartments.theme.of(themeExtension(options.settings.theme)),
    options.compartments.platform.of(options.platformExtensions(context)),
  ]
  const config = { doc: options.doc, extensions }
  // fromJSON 会连同 historyField 一起还原，撤销栈与选区因此能跨重挂载保留。
  return options.initialState
    ? EditorState.fromJSON(options.initialState.json as never, config, options.initialState.fields as never)
    : EditorState.create(config)
}

/**
 * 创建 EditorView。这是编辑器代码里唯一 new EditorView 的位置——
 * 稳定生命周期的前提是「一个挂载中的编辑区域只有一个视图」。
 */
export function createEditorView(state: EditorState, parent: HTMLElement): EditorView {
  return new EditorView({ state, parent })
}
