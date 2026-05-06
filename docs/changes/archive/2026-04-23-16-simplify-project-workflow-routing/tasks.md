## 1. 项目规范路由模型

- [x] 1.1 重写项目路由构造与解析逻辑，使项目主页规范地址变为 `/<home-relative-path>`，并移除 `/project` 公共前缀
- [x] 1.2 在项目路径不位于家目录下时回退为完整绝对路径段，保持同一套路由解析流程
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-route-addressing.spec.js --grep "项目主页使用家目录相对路径"` 全部通过

## 2. 工作流与会话稳定编号

- [x] 2.1 为项目工作流增加稳定且不回收的 `routeIndex` 持久化字段，并把工作流详情路由切换到 `/<project>/wN`
- [x] 2.2 为项目手动会话增加稳定且不回收的 `routeIndex` 持久化字段，并把手动会话路由切换到 `/<project>/cN`
- [x] 2.3 为工作流子会话增加工作流内稳定且不回收的 `routeIndex` 持久化字段，并把子会话路由切换到 `/<project>/wN/cN`
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-route-addressing.spec.js --grep "工作流详情使用稳定的 w1 路由|手动会话使用稳定的 c1 路由|工作流子会话使用嵌套的 w1/c1 路由"` 全部通过

## 3. 持久化上下文恢复

- [x] 3.1 在相应会话 JSON/JSONL 与工作流存储中写入 provider、所属项目、所属工作流、阶段和子阶段等恢复所需字段
- [x] 3.2 删除基于 `provider`、`projectPath`、`workflowId` 等查询参数的路由恢复依赖，统一改为从规范路径和持久化数据恢复
- [x] 3.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-route-addressing.spec.js --grep "刷新工作流子会话页时不依赖查询参数恢复上下文"` 全部通过

## 4. 路由生成与验收收口

- [x] 4.1 更新工作流详情、项目导航和新建会话流程，确保前端只生成新规范地址
- [x] 4.2 清理旧路由和旧数据兜底逻辑，确保新测试只验证新规则
- [x] 4.3 验收：`bash openspec/changes/2-simplify-project-workflow-routing/test_cmd.sh` 返回 0
