#!/bin/zsh
# Finder 双击即可执行与 pnpm ios 相同的 Release 覆盖安装流程。

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR" || exit 1

echo "========================================="
echo "  Swell Note → Swell5 一键安装"
echo "========================================="
echo ""

pnpm ios
RESULT=$?

echo ""
if [[ $RESULT -eq 0 ]]; then
  echo "安装流程已完成。"
else
  echo "安装失败，请保留上方错误信息。"
fi

if [[ -t 0 ]]; then
  read -k 1 "?按任意键关闭窗口…"
  echo ""
fi

exit $RESULT
