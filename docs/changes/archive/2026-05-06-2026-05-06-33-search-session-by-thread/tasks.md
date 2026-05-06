## 1. 后端搜索语义

- [x] 1.1 为 Codex JSONL 文件路径派生稳定 `thread` 字段：`rollout-YYYY-MM-DDTHH-MM-SS-<thread>.jsonl` 提取 `<thread>`，其他文件名回退到 basename
- [x] 1.2 为 `/api/chat/search` 增加显式搜索模式参数，支持 `content` 与 `jsonl` 两种互斥模式
- [x] 1.3 在 `jsonl` 模式下只将 `thread`、完整 JSONL 文件名、basename 纳入会话级搜索匹配字段
- [x] 1.4 在 `content` 模式下保持现有 transcript 可见文本搜索，不匹配 JSONL 文件名或 thread
- [x] 1.5 扩展 `/api/chat/search` 结果协议，支持 `resultType: "session"` 的会话级结果，并保持现有消息级结果兼容
- [x] 1.6 确保 Codex 搜索结果的 `sessionId` 使用可传给 `codex resume` 的 thread 标识，不使用完整 JSONL 文件名或带时间戳前缀的 basename
- [x] 1.7 确保 workflow runner 输出的 `threadId/thread_id/sessionId` 与搜索结果中的 Codex `sessionId` 保持一致

## 2. 前端搜索交互

- [x] 2.1 在左侧导航栏搜索弹窗中增加互斥模式选择：`JSONL 文件名/thread` 与 `文件内容`
- [x] 2.2 根据当前模式调整输入占位文案和空结果文案，让用户明确知道正在搜哪类数据
- [x] 2.3 更新搜索结果类型与渲染，让会话级 thread 命中显示 provider、项目、摘要和 thread
- [x] 2.4 更新点击跳转逻辑：会话级结果不传 `messageKey`，只打开目标会话；消息级结果继续滚动并高亮
- [x] 2.5 保持空结果、loading、error 状态不回退

## 3. 验收测试

- [x] 3.1 新增 Codex fixture：文件名为 `rollout-2026-04-30T00-27-02-019dda10-ba67-7973-ac49-3ae9102d38cd.jsonl`，消息正文不包含 thread
- [x] 3.2 验收：打开搜索弹窗后能明确选择 `JSONL 文件名/thread` 或 `文件内容`
- [x] 3.3 验收：在 `JSONL 文件名/thread` 模式搜索 `019dda10-ba67-7973-ac49-3ae9102d38cd` 返回会话级 Codex 结果并可点击打开
- [x] 3.4 验收：在 `JSONL 文件名/thread` 模式搜索完整 JSONL 文件名也返回同一会话
- [x] 3.5 验收：在 `文件内容` 模式搜索只存在于 JSONL 文件名中的 thread 返回无结果
- [x] 3.6 验收：打开结果后的会话 id 为 `019dda10-ba67-7973-ac49-3ae9102d38cd`，后续 Codex 继续消息会把该 thread 作为 resume id
- [x] 3.7 验收：workflow runner 进程行中的同名 thread 搜索结果进入 workflow child session，而不是普通手动会话
- [x] 3.8 验收：同一字符串同时存在于消息正文和 thread 时，两种模式分别返回对应类型结果，不混合
- [x] 3.9 验收命令：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-full-text-search.spec.js tests/spec/project-workspace-navigation.spec.js -g "thread|JSONL file name|search mode|workflow child session"`
