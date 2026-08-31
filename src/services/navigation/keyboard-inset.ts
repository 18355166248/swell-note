export type ViewportSample = {
  layoutHeight: number
  visualHeight: number
  visualOffsetTop?: number
}

// 手机键盘弹出时布局视口（100dvh）不会变化，只有 visualViewport 会缩到键盘上沿；
// 两者的差值就是键盘连同输入辅助栏遮住的高度，页面据此把底部工具栏顶到键盘上方。
export function getKeyboardInset({ layoutHeight, visualHeight, visualOffsetTop = 0 }: ViewportSample) {
  if (![layoutHeight, visualHeight, visualOffsetTop].every(Number.isFinite) || layoutHeight <= 0) return 0
  const covered = layoutHeight - visualHeight - visualOffsetTop
  // 视口高度带小数，滚动回弹也会产生几像素抖动；小于一行工具栏按钮的差值一律当作没有键盘。
  if (covered <= 48) return 0
  // 极端情况下（横屏 + 大键盘）留出最低可视高度，避免工作区被压成 0 而看不到正文。
  return Math.min(Math.round(covered), Math.round(layoutHeight * 0.9))
}
