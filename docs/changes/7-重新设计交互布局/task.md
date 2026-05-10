## 1. 布局模型

- [ ] 1.1 梳理 `MainContent`、`MainContentHeader`、`MainContentTabSwitcher` 和 `AppTab` 的现有调用关系。
- [ ] 1.2 设计 `WorkspaceLayoutState`，覆盖 right dock、bottom dock、split、collapse、resize、fullscreen。
- [ ] 1.3 实现布局状态 hook，并支持默认值、持久化、坏数据回退和旧 `activeTab` 兼容。
- [ ] 1.4 明确桌面和移动端使用不同布局规则，避免桌面 dock 状态破坏移动端。

## 2. 主工作区外壳

- [ ] 2.1 新增或改造工作区 dock layout 组件，确保 center 区始终承载聊天或项目主页。
- [ ] 2.2 将 `FileTree` 挂载到右侧 dock，默认显示。
- [ ] 2.3 将 `GitPanel` 挂载到右侧 dock，并和 `FileTree` 互斥切换。
- [ ] 2.4 将 `StandaloneShell` 挂载到底部 dock，默认显示。
- [ ] 2.5 保留 `EditorSidebar` 的文件打开能力，并处理它和右侧 dock 的宽度/展开冲突。

## 3. 点击行为

- [ ] 3.1 将 `消息` 按钮改为聚焦聊天正文或聊天输入，而不是切换互斥 tab。
- [ ] 3.2 将 `文件` 按钮改为打开右侧文件 dock。
- [ ] 3.3 将 `源代码管理` 按钮改为打开右侧 Git dock。
- [ ] 3.4 将 `终端` 按钮改为展开/折叠或聚焦终端 dock。
- [ ] 3.5 更新 i18n、aria-label、tooltip 和测试选择器，让按钮语义从 tab 转为 layout control。

## 4. 折叠、拉伸和全屏

- [ ] 4.1 为右侧 dock 添加折叠/展开、水平 resize 和全屏控制。
- [ ] 4.2 为底部 dock 添加折叠/展开、垂直 resize 和全屏控制。
- [ ] 4.3 为右侧上下 split 添加 split ratio resize。
- [ ] 4.4 确认全屏退出后恢复进入全屏前的位置、尺寸和 active panel。
- [ ] 4.5 确认 resize 不会导致聊天输入、终端或右侧工具被挤到不可用尺寸。

## 5. 拖拽重排

- [ ] 5.1 为终端 panel header 添加拖拽 handle。
- [ ] 5.2 实现底部 drop zone 和右侧下半区 drop zone。
- [ ] 5.3 支持把终端从底部拖到右侧下半区。
- [ ] 5.4 支持把终端从右侧下半区拖回底部。
- [ ] 5.5 拖拽过程中显示明确 drop indicator，并保留按钮操作作为替代路径。

## 6. 移动端

- [ ] 6.1 移动端点击文件或源代码管理时使用抽屉或 overlay。
- [ ] 6.2 移动端点击终端时使用底部 sheet 或全屏面板。
- [ ] 6.3 移动端关闭工具面板后恢复聊天正文。
- [ ] 6.4 确认移动端不使用桌面拖拽重排状态。

## 7. 真实测试代码

- [ ] 7.1 在本提案 `tests/` 目录编写真实 Playwright 测试，执行阶段同步到仓库根测试套件。
- [ ] 7.2 Playwright 测试默认布局：聊天中间、文件右侧、终端底部。
- [ ] 7.3 Playwright 测试点击文件/Git/终端后聊天仍可见。
- [ ] 7.4 Playwright 测试文件和 Git 在右侧互斥显示。
- [ ] 7.5 Playwright 测试右侧 dock 和底部 dock 的折叠、拉伸和全屏。
- [ ] 7.6 Playwright 测试终端从底部拖到右侧下半区，再拖回底部。
- [ ] 7.7 Playwright 测试刷新后恢复布局，坏布局状态回退默认布局。
- [ ] 7.8 Playwright 测试移动端 overlay/sheet 行为。

## 8. 验证

- [ ] 8.1 运行 `oz validate 7-重新设计交互布局 --json`。
- [ ] 8.2 运行主布局相关 Playwright 测试。
- [ ] 8.3 运行 shell、file tree、git panel 既有测试，确认业务组件未被布局重构破坏。
- [ ] 8.4 手动检查桌面宽屏、窄屏和移动端布局。
- [ ] 8.5 手动确认终端连接在折叠、全屏和拖拽重排后仍可用。
