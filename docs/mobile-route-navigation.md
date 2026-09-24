# 移动端路由导航与侧滑返回

## 选型结论

本轮继续使用项目已经依赖的 React Router 7，并在笔记工作区内增加按 `location.key` 管理的页面保活层。URL 和浏览器 history 是页面前进、后退、刷新及深链的唯一来源；保活层只保存已经提交过的页面实例，不维护另一套业务导航状态。

评估过的开源方案：

| 方案 | 能力 | 对当前项目的影响 | 结论 |
| --- | --- | --- | --- |
| [React Router HashRouter](https://reactrouter.com/api/declarative-routers/HashRouter) | 使用 URL hash 管理客户端 history，现有项目已覆盖路由、深链与设置页 | 只需补足移动端页面栈和交互手势，无需迁移全站路由 | 采用 |
| [TanStack Router](https://tanstack.com/router/latest/docs/guide/type-safety) | 路由参数、搜索参数和 loader 的类型能力更强 | 需要迁移现有 Routes、导航调用和测试；页面 DOM 保活仍需单独设计 | 暂不迁移 |
| [Stackflow](https://stackflow.so/docs/advanced/history-sync) | 面向 Web 的 stack、手势和 history 同步能力接近目标交互 | 需要把当前 HashRouter 的 history owner 迁移到 Stackflow，并重接桌面、设置、待办与深链 | 暂不迁移 |
| [Ionic Framework](https://github.com/ionic-team/ionic-framework) | `IonRouterOutlet` 面向移动端页面转场与页面状态保留 | 会引入 Ionic 页面容器、样式及生命周期约束，改造范围远大于本次问题 | 暂不引入 |
| [React Navigation Web](https://reactnavigation.org/docs/web-support/) | React Native 与 Web 可共享导航模型 | Web 端需要 React Native for Web，且官方说明 Web 上不支持原生栈手势 | 不适合当前 React + Tauri Web 应用 |

## 实现模型

`/notes` 下的菜单、目录、视图和笔记详情都通过 React Router 导航：

- 打开目录或笔记使用 `PUSH`，浏览器后退、标题栏返回和完成的侧滑都执行同一个 `POP`。
- 主导航抽屉是带 `location.state.mobileOverlay` 的 modal history entry。浏览器返回先关闭抽屉；从抽屉选择目标时用 `REPLACE` 消掉 overlay，并把目标作为页面栈的下一项。
- 详情重命名使用 `REPLACE` 更新 URL，同时保留 entry 的 `mountKey` 和 `editorSessionKey`，避免 CodeMirror 重挂。
- 深链没有站内上一条 history 时，保活层先挂载语义 fallback。返回使用 `REPLACE`，不会退出应用或停在空页面。
- 切换笔记库会用 cache id 重建整个工作区页面栈，防止复用上一笔记库的筛选、滚动或编辑器实例。

每个 history entry 自己持有搜索词、标签、排序、是否包含子目录以及滚动位置。共享的笔记数据始终读取最新状态；编辑、任务、附件和资源读取按该 entry 的 note id 绑定。隐藏页设置 `inert`，编辑器会停止全局快捷键、查找聚焦、大纲监听和异步附件聚焦，但它的 DOM、撤销栈与选择状态仍保留。

侧滑手势分为 `idle`、`dragging`、`returning`、`completing` 四个阶段。达到阈值后，当前页先完成滑出动画，再触发路由返回；在新 `location.key` 提交前保持完成态。取消、异步清理失败或导航拒绝会回弹，迟到的旧 Promise 由手势代际隔离，不能复位新页面。

按钮触发的 `PUSH` 当前在路由提交后直接显示目标 entry，本轮没有恢复旧实现的点击入场动画。手势 `POP` 保留跟手、回弹和完成动画；避免在手势完成后再给恢复页追加一次入场动画，是消除二次位移和闪帧的优先约束。

## 边界与验证范围

保活范围目前是 `/notes` 笔记工作区。设置和待办仍沿用现有页面生命周期，离开笔记工作区时会卸载工作区；跨整个应用没有零重建保证。待办和设置首页复用边缘手势打开主导航，设置二级页复用同一手势返回设置首页，拖动时以设置首页作为底层页面。

当前实现保留本次会话内可达的笔记工作区 history entries，尚未设置 LRU 上限。大型笔记库长时间连续打开大量详情时需要继续观察内存；后续如增加上限，应至少保护 current 和 previous entry，并明确老历史 POP 会重建页面。

最终验证结果：

- `pnpm exec vitest run`：93 个测试文件通过，1 个跳过；777 项测试通过，1 项跳过。
- `./node_modules/.bin/tsc --noEmit`：通过。
- `pnpm build`：通过；保留现有 CSS `::highlight` 识别提示和大 chunk 提示。
- `pnpm exec playwright test e2e/core-workflows.spec.ts`：桌面与手机 Chrome 项目共 17 项通过、17 项按项目条件跳过。
- 路由相关链接回归：桌面链接、移动端链接面板、A→B 编辑隔离、同名 Wiki 锚点共 4 项通过、4 项按项目条件跳过。
- 临时 WebKit iPhone 视口配置运行核心侧滑与 DOM 保活：2 项通过；配置未加入默认项目。

浏览器自动化不能替代真机。仍需在 iOS/Android 真机验证系统手势仲裁、软键盘和帧稳定性。
