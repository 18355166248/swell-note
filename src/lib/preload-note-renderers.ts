// 编辑器 / 预览 / Canvas 画布都是懒加载 chunk（体积大，正常情况下延迟到真正渲染时才加载，
// 避免拖慢首屏资料库与列表）。但应用启动时几乎总有一篇笔记已经处于激活状态：
// cacheReady 一变 true，Workspace 和这几个 chunk 就在同一帧里被同时需要，
// 根本等不到「组件挂载后 idle」——那时候用户已经在盯着加载占位了。
// 这里改成应用一启动、还在等 vault 初始化（读缓存、连远端）的时候就在后台把请求发出去，
// 与初始化并行，不占同步渲染的时间；等笔记真正可见时大概率已经取到或取了一半。
// 路径必须和 workspace.tsx 里 lazyWithRetry(() => import(...)) 用的完全一致，
// 两边的动态 import 才会命中同一个模块缓存，不会重复下载。
let preloaded = false

export function preloadNoteRenderers() {
  if (preloaded) return
  preloaded = true
  void import("@/components/editor/markdown-editor")
  void import("@/components/editor/markdown-preview")
  void import("@/components/editor/canvas-preview")
}
