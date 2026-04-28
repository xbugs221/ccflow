## Why

当前 `ccflow` 把全局项目树、项目主页、需求工作流详情页和手动会话页混在同一套壳层里，导致桌面端层级混乱、移动端入口分散，用户很难判断“我当前在看项目概览、工作流详情，还是具体会话”。这次需要把项目明确收敛为工作区入口，并把工作内容导航收敛为“当前项目内的工作流与手动会话”，优先解决难用问题而不是继续堆叠新入口。

## What Changes

- 新增项目工作区导航能力：把 `/project/:projectSlug` 定义为项目工作区入口页，在该页默认展示项目详情，并把项目切换入口放到页面顶部区域。
- 把工作流详情页和手动会话页调整为项目作用域路由，只有进入具体工作内容后才显示左侧工作区导航。
- 将左侧工作区导航固定为两个分组：上方“需求工作流”，下方“手动会话”，并且只展示当前项目内的数据，保留重命名、删除、收藏等现有操作。
- 修改需求工作流详情页：默认先显示详情正文，桌面端右上角增加可交互阶段缩略图，点击阶段节点后跳转到已有子会话，或在当前详情页高亮对应阶段。
- 调整移动端壳层：在项目主页不展示左侧导航，进入工作流/会话后通过抽屉查看项目内导航，并默认隐藏工作流缩略图。
- **BREAKING**：取消“全局项目树始终常驻 + 项目内内容嵌套其中”的主导航模型，改为“项目主页壳层”和“项目内工作内容壳层”两套显式页面。

## Capabilities

### New Capabilities
- `project-workspace-navigation`: 定义项目工作区入口页、项目内工作内容壳层、项目切换入口以及移动端抽屉导航行为。

### Modified Capabilities
- `project-workflow-control-plane`: 调整需求工作流详情页和项目内导航的要求，使其符合新的项目工作区路由、双分组导航和可交互阶段缩略图行为。

## Impact

- 前端路由与状态：`src/App.tsx`、`src/components/app/AppContent.tsx`、`src/hooks/useProjectsState.ts`、`src/utils/projectRoute.ts`
- 项目与工作流界面：`src/components/main-content/view/**`、`src/components/sidebar/view/**`、`src/components/MobileNav.jsx`
- 工作流详情与阶段跳转：`src/components/main-content/view/subcomponents/WorkflowDetailView.tsx`
- 验收测试与文档：`tests/spec/**`、`tests/spec/README.md`、`openspec/changes/2030-ccflow-ui/test_cmd.sh`
