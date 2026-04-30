# 设计：优化项目主页会话卡片展示

## 时间戳

- 复用 `dateUtils.ts` 中的 `formatTimeAgo` 函数
- 参数：`sessionView.sessionTime`, `currentTime`, `t`
- 替换 `ProjectOverviewPanel.tsx` 中的 `formatTimestamp` 调用

## 未读状态指示灯

- 复用 `SidebarSessionItem.tsx` 中的 localStorage 签名机制
- 工具函数：`getViewedSessionKey`, `getSessionActivitySignature`, `readViewedSessionSignature`, `writeViewedSessionSignature`
- 在 `ProjectOverviewPanel.tsx` 组件级别维护 `viewedSignatures` state
- 点击卡片时标记为已读
- 指示灯位置：卡片右上角（`absolute right-3 top-3`）
- 样式：黄色圆点 `h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-sm`

## 右键菜单文字

- 修改 `SessionActionIconMenu.tsx`
- 按钮样式从 `h-9 w-9 items-center justify-center` 改为 `w-full items-center gap-2 px-3 py-2 text-left`
- 容器从 `items-center gap-1` 改为 `min-w-[140px] flex-col gap-0.5`
- 每个按钮显示 icon + label 文字
