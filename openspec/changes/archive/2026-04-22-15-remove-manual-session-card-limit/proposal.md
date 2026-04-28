## Why

项目主页里的“手动会话”控制面当前只能稳定展示前 5 个卡片，用户必须先隐藏或删除前面的会话，后面的会话才有机会出现。这让项目主页失去作为会话总览入口的价值，也会误导用户以为后续会话已经丢失。

## What Changes

- 取消项目主页“手动会话”卡片的固定数量上限，已加载且未隐藏的会话都应可见。
- 保持现有会话排序、折叠展开、右键菜单和新建会话入口不变，仅移除数量裁剪行为。
- 为项目主页补充针对“超过 5 个手动会话仍全部可见”的验收场景，防止再次引入截断回归。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-workflow-control-plane`: 调整项目主页手动会话区域的展示要求，确保不会因为固定卡片上限截断已加载会话。

## Impact

- 受影响代码主要在 `src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx` 及其数据输入链路。
- 受影响验收测试位于 `tests/spec/project-workflow-control-plane.spec.js`，需要新增覆盖超出 5 个手动会话的真实业务场景。
- 不涉及外部 API、数据库 schema 或依赖升级。
