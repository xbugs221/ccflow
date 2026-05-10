## 1. 设置页入口收敛

- [ ] 1.1 将 `SettingsMainTab`、tab 常量和 tab 渲染收敛到 `appearance | agents | diagnostics`。
- [ ] 1.2 删除 `Settings.tsx` 中的 Git tab 和 API tab 渲染分支。
- [ ] 1.3 将旧的 `git`、`api` 初始 tab 归一化到 `appearance`。
- [ ] 1.4 清理设置页中不再使用的 icon、props、hooks 和类型。

## 2. 外观页瘦身

- [ ] 2.1 从 `AppearanceSettingsTab` 移除项目排序设置组。
- [ ] 2.2 从 `AppearanceSettingsTab` 移除代码编辑器设置组。
- [ ] 2.3 从设置 controller 移除项目排序和代码编辑器设置页专用状态。
- [ ] 2.4 删除不再使用的外观设置翻译键和测试断言。

## 3. 删除 Git 和 API 设置能力

- [ ] 3.1 删除设置页 Git tab 前端组件和 `useGitSettings`。
- [ ] 3.2 删除全局 git config 读写后端入口和只服务该入口的工具代码。
- [ ] 3.3 删除设置页 API 和令牌前端组件、hook、类型和文案。
- [ ] 3.4 删除外部 API key 设置页管理入口、公开 API 文档和相关测试。
- [ ] 3.5 审计项目创建中的 GitHub token 路径，确保一次性 token 业务不依赖已删除设置 tab。

## 4. 智能体页调整

- [ ] 4.1 删除智能体页 MCP 服务器子 tab 和卡片渲染。
- [ ] 4.2 清理设置页 Codex MCP 表单状态、弹窗和只服务该卡片的 props。
- [ ] 4.3 新增或接入 OpenCode icon，并让 `SessionProviderLogo` 对 `opencode` 返回该 icon。
- [ ] 4.4 建立 OpenCode 状态后端接口或复用稳定诊断接口，返回已连接 provider。
- [ ] 4.5 前端展示 OpenCode 已连接 provider、未连接 provider 和错误状态。

## 5. 诊断和语言

- [ ] 5.1 将 `RuntimeDiagnosticsTab` 的硬编码英文迁移到 i18n。
- [ ] 5.2 为中文和英文补齐诊断 tab 文案。
- [ ] 5.3 从 i18n config 删除 `ja`、`ko` resource import 和注册。
- [ ] 5.4 从语言列表删除日语和韩语。
- [ ] 5.5 删除 `src/i18n/locales/ja/` 和 `src/i18n/locales/ko/`。
- [ ] 5.6 确认保存了 `ja` 或 `ko` 的旧用户启动时回退到 `en`。

## 6. 左侧导航栏工具区

- [ ] 6.1 从左侧导航栏顶部移除刷新、新建项目、搜索项目、搜索聊天记录、设置和收起侧栏按钮。
- [ ] 6.2 删除“搜索项目”按钮、项目搜索输入框和不可触达的项目搜索状态。
- [ ] 6.3 将刷新项目、新建项目、搜索聊天记录、设置移动到底部工具区。
- [ ] 6.4 将桌面端收起侧栏按钮移动到底部工具区。
- [ ] 6.5 确认移动端底部工具区避开 safe-area，折叠态不展示项目搜索。

## 7. 真实测试代码

- [ ] 7.1 在本提案 `tests/` 目录编写真实 Playwright 设置页验收测试，执行阶段同步到仓库根测试套件。
- [ ] 7.2 Playwright 覆盖设置页只显示外观、智能体、诊断三个 tab。
- [ ] 7.3 Playwright 覆盖外观页不再显示项目排序和代码编辑器设置。
- [ ] 7.4 Playwright 覆盖智能体页不显示 MCP 服务器，并显示 OpenCode icon 和已连接 provider。
- [ ] 7.5 Playwright 覆盖中文诊断页全部关键文案中文化。
- [ ] 7.6 Playwright 覆盖左侧导航栏顶部不显示项目操作按钮，底部显示保留的导航工具按钮，且不再显示搜索项目。
- [ ] 7.7 server/static 测试覆盖 ja/ko 资源移除、语言回退、旧 Git/API 设置入口删除。

## 8. 验证

- [ ] 8.1 运行 `oz validate 6-精简设置页和侧边栏导航 --json`。
- [ ] 8.2 运行设置页和左侧导航栏相关 Playwright 测试。
- [ ] 8.3 运行 i18n/static 测试。
- [ ] 8.4 运行 server 测试，确认项目级 Git 能力仍可用。
- [ ] 8.5 手动打开设置页，检查中文界面下无 Git/API/MCP/日语/韩语入口。
- [ ] 8.6 手动检查左侧导航栏桌面、移动和折叠态布局。
