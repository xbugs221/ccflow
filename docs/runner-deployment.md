# ccflow Runner Deployment

ccflow Web 服务只负责提交 Codex/OpenCode turn 和 tail `.ccflow/runtime/turns/<turnId>/events.jsonl`。实际 CLI 由 `server/ccflow-runner.js` 独立进程执行。

部署时不要把 runner 或它启动的 Codex/OpenCode CLI 放进会随 Web service restart 一起终止的 cgroup。systemd 场景设置 `CCFLOW_RUNNER_SYSTEMD_SCOPE=1` 后，Web 服务会通过 `systemd-run --user --scope` 启动 runner，让 turn 进入独立 user scope。service 仍必须保留相同工作目录、HOME、PATH、Codex/OpenCode 认证环境和 `.ccflow/runtime/turns` 写权限。

重启验证：

1. 发起一个 fake 或真实 Codex/OpenCode 长 turn。
2. 确认 `.ccflow/runtime/turns/<turnId>/turn.json` 中 `status` 为 `running` 且 `pid` 存活。
3. 重启 Web service。
4. 确认 runner 继续向 `events.jsonl` 追加事件。
5. 浏览器重连后确认后续 `codex-response` 或 `opencode-response` 仍展示。
