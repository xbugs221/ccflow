## 1. co 协议准备

- [x] 1.1 确认 `co-request-v1` 字段：`request_id`、`op`、`conversation_id`、`project_path`、`provider`、`text`、`active_policy`、`target_turn_id`、`options`、`attachments`、`actor`。
- [x] 1.2 确认 conversation state 和 turn state 文件格式。
- [x] 1.3 确认 `events.jsonl` 事件类型和必需字段。
- [x] 1.4 确认 `co doctor --json` 输出格式和 ccflow 启动检查规则。
- [x] 1.5 与 co Go 实现约定 request 原子写入、claim、幂等和 rejected 事件语义。

## 2. ccflow co 适配层

- [x] 2.1 新增 co home 解析：支持 `CCFLOW_CO_HOME`，默认 `~/.local/state/ccflow/co`。
- [x] 2.2 新增 co doctor 检查，并在设置/诊断页展示 co 可用性。
- [x] 2.3 新增 co request 写入模块，使用临时文件加 rename 原子写入 pending 目录。
- [x] 2.4 新增 conversation state 和 turn state 读取模块。
- [x] 2.5 新增 co events tail 模块，将 `events.jsonl` 转发为现有 WebSocket 事件。

## 3. 聊天发送路径改造

- [x] 3.1 将 Codex 消息发送改为写入 `op = message` request。
- [x] 3.2 将 OpenCode 消息发送改为写入 `op = message` request。
- [x] 3.3 同会话续发时复用 `conversation_id`，不要求前端提供 provider session id。
- [x] 3.4 运行中第二条消息根据 UI 操作写入合适 `active_policy`。
- [x] 3.5 附件只以稳定文件路径引用写入 request。

## 4. 中断和恢复

- [x] 4.1 停止按钮改为写入 `op = abort` request。
- [x] 4.2 abort request 带上当前 UI 看到的 `target_turn_id`。
- [x] 4.3 ccflow 启动和网页刷新时读取 conversation state 恢复 active turn。
- [x] 4.4 ccflow 对 active turn 重新 tail `events.jsonl`。
- [x] 4.5 多窗口重复 request 使用 `request_id` 幂等处理。

## 5. 删除旧执行路径

- [x] 5.1 删除 `server/ccflow-runner.js`。
- [x] 5.2 删除 `server/runner-turns.js`。
- [x] 5.3 删除 WebSocket 中直接调用 `queryCodex` / `queryOpencode` 执行 CLI 的生产路径。
- [x] 5.4 删除 Node 侧 active provider session 进程表和 abort provider 进程管理。
- [x] 5.5 保留 provider 历史读取所需代码，直到 co 提供完整替代 read model。

## 6. 测试代码

- [x] 6.1 在本提案 `tests/` 目录编写真实测试代码，并在执行阶段同步到仓库根测试套件。
- [x] 6.2 server 测试：发送 Codex 消息只写 co request，不 spawn provider CLI。
- [x] 6.3 server 测试：发送 OpenCode 消息只写 co request，不 spawn provider CLI。
- [x] 6.4 server 测试：运行中第二条消息写入正确 `active_policy` 和 `target_turn_id`。
- [x] 6.5 server 测试：停止按钮写入 `op = abort` request。
- [x] 6.6 server 测试：co 不可用时聊天发送被拒绝且无旧 runner fallback。
- [x] 6.7 browser 测试：刷新网页后从 co conversation state 恢复 running turn 并继续显示事件。
- [x] 6.8 browser 测试：多窗口对同一 conversation 操作时不会重复提交或误中断新 turn。

## 7. 验证

- [x] 7.1 运行 `oz validate 2026-05-09-4-使用co聊天执行器瘦身ccflow --json`。
- [x] 7.2 运行相关 server 测试。
- [x] 7.3 运行相关 browser/spec 测试。
- [x] 7.4 手动验证 systemd 重启 ccflow 时 co 管理的运行中 turn 不被杀死。
