<!-- PURPOSE: Persist project-specific operational memory so future development
does not accidentally reintroduce watcher/resource conflicts or lose track of
where runtime errors should be inspected. -->

# MEMORY

## 服务分层约定

- `ccflow.service` 只用于稳定版运行，不要再把 `vite build --watch`、`node --watch`、`tsc --watch` 这类开发 watcher 塞进这个 service。
- 公网访问走的是这套稳定服务；修改前端后需要先 `pnpm build`，再让稳定服务读取新的 `dist/`。
- 开发期 watcher 统一通过仓库脚本 `scripts/dev-watch.sh` 启动。

## 开发 watcher 入口

- 开发时使用 `pnpm dev:watch`。
- 这个脚本会同时启动：
  - `pnpm exec tsc --noEmit -p tsconfig.json --watch --preserveWatchOutput`
  - `node --watch server/index.js`
  - `vite build --watch`

## 报错查看位置

- 稳定服务报错优先看：
  - `systemctl --user status ccflow.service --no-pager`
  - `journalctl --user -u ccflow.service -n 200 --no-pager`
- 如果是开发 watcher 报错，直接看运行 `pnpm dev:watch` 的终端输出，不要和稳定 service 日志混在一起判断。

## 避免资源争抢

- 在已经运行 `pnpm dev:watch` 时，不要再手工重复启动另一套 `vite build --watch`、`node --watch`、`tsc --watch`。
- 在稳定服务运行时，也不要把开发 watcher 再塞回 `ccflow.service`，否则会出现：
  - CPU / 内存 / 磁盘 IO 重复占用
  - 构建与日志来源混乱
  - 误判“当前公网到底跑的是哪一套进程”

## 重启注意事项

- 如果当前 Codex/Claude 会话本身就是经由 `ccflow.service` 提供的 WebSocket 运行，直接在该会话里重启 `ccflow.service` 可能会把当前会话一起杀掉。
- 这种场景下，优先使用延迟重启或外部终端执行重启，不要在当前活跃会话里直接硬重启。
