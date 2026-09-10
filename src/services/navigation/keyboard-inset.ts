export type ViewportSample = {
  layoutHeight: number
  visualHeight: number
  visualOffsetTop?: number
  visualScale?: number
}

// 手机键盘弹出时布局视口（100dvh）不会变化，只有 visualViewport 会缩到键盘上沿；
// 两者的差值就是键盘连同输入辅助栏遮住的高度，页面据此把底部工具栏顶到键盘上方。
export function getKeyboardInset({ layoutHeight, visualHeight, visualOffsetTop = 0, visualScale = 1 }: ViewportSample) {
  if (![layoutHeight, visualHeight, visualOffsetTop, visualScale].every(Number.isFinite) || layoutHeight <= 0) return 0
  // 捏合缩放也会缩小 visualViewport 的高度，但那与键盘无关；缩放期间一律按没有键盘处理，
  // 否则移动工作区和弹出菜单会被误收缩。
  if (visualScale > 1) return 0
  const covered = layoutHeight - visualHeight - visualOffsetTop
  // 视口高度带小数，滚动回弹也会产生几像素抖动；小于一行工具栏按钮的差值一律当作没有键盘。
  if (covered <= 48) return 0
  // 极端情况下（横屏 + 大键盘）留出最低可视高度，避免工作区被压成 0 而看不到正文。
  return Math.min(Math.round(covered), Math.round(layoutHeight * 0.9))
}

// iOS WKWebView 弹键盘时会把整个文档向上滚（window.scrollY / visualViewport.offsetTop 变大），
// 页面骨架是 overflow:hidden 的固定布局，被顶出去后导航消失、正文侵入状态栏。
// 骨架本身没有可滚空间，检测到这种位移就应立即复位。
// 捏合缩放（visualScale > 1）下平移同样产生 scrollY/offsetTop，那是用户主动的视口操作，不能复位。
export function shouldResetWindowScroll({ scrollY, visualOffsetTop = 0, visualScale = 1 }: { scrollY: number; visualOffsetTop?: number; visualScale?: number }) {
  if (![scrollY, visualOffsetTop, visualScale].every(Number.isFinite)) return false
  if (visualScale > 1) return false
  return scrollY > 0 || visualOffsetTop > 0
}
