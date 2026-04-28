# OpenSpec 验收测试

这些测试是 OpenSpec 验收用例，覆盖配置迁移、项目发现、工作区导航、聊天搜索、文件树和工作流控制面等真实业务链路。

## 测试文件

- `test_project_chat_config_v2.js`：覆盖 `project-chat-config-v2`，验证 `conf.json` v2 的 `chat` / `workflows` 结构、普通会话编号、草稿 finalize 和旧字段不再写入。
- `test_project_workflow_control_plane_conf_v2.js`：覆盖 `project-workflow-control-plane`，验证工作流编号由数字 key 推导、内部会话顺序编号、内部草稿 finalize 和不占用顶层 `chat` 编号。
- `test_codex_project_discovery_conf_v2.js`：覆盖 `codex-project-discovery`，验证终端 Codex 会话导入顶层 `chat`、标题取第一条用户指令且不会重复分配编号。

## 运行命令

```bash
pnpm run test:spec
```

只运行 node:test 规格：

```bash
pnpm run test:spec:node
```

只运行 Playwright 规格：

```bash
pnpm run test:spec:browser
```
