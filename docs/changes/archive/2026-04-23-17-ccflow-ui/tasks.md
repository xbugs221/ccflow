## 1. 项目工作区路由与壳层

- [x] 1.1 引入项目作用域路由，显式区分项目主页、工作流详情页和手动会话页
- [x] 1.2 在项目主页头部实现项目切换入口，并移除该页面上的左侧工作区导航
- [x] 1.3 重构桌面端与移动端壳层，让左侧工作区导航只在 workflow/session 页面出现，且只展示当前项目数据
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workspace-navigation.spec.js` 全部通过

## 2. 项目内双分组导航

- [x] 2.1 把项目内导航固定为“需求工作流在上、手动会话在下”两个分组
- [x] 2.2 复用现有改名、删除、收藏、待处理等交互到新的项目内导航
- [x] 2.3 保证从 workflow/session 页切换到同项目其他内容时，选中态与刷新恢复保持稳定
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane-routing.spec.js --grep "项目工作区导航按需求工作流与手动会话分组显示"` 全部通过

## 3. 需求工作流详情与阶段缩略图

- [x] 3.1 让点击工作流列表项默认进入 workflow 详情页，而不是直接进入子会话
- [x] 3.2 在桌面端 workflow 详情页右上角实现可交互阶段缩略图，并支持“跳到已有子会话 / 高亮未生成阶段”
- [x] 3.3 在手动会话详情页和移动端 workflow 页面隐藏阶段缩略图
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane-routing.spec.js --grep "工作流详情默认展示缩略阶段图并支持节点跳转|手动会话详情不展示工作流阶段缩略图"` 全部通过

## 4. 集成验收

- [x] 4.1 更新验收测试清单与变更内 test_cmd 脚本
- [x] 4.2 验收：`bash openspec/changes/2030-ccflow-ui/test_cmd.sh` 返回 0
