// 正文与表格共享平台规则；iPad 桌面 UA 和手机模拟可能同样报告 MacIntel。
export function requiresLinkModifier(readOnly: boolean) {
  return !readOnly && /Mac/i.test(navigator.platform) && !(navigator.maxTouchPoints > 0)
}
