## 1. 边界文档

- [ ] 1.1 新增 ccflow thin backend 职责文档。
- [ ] 1.2 明确 co/wo 执行职责不属于 ccflow backend。
- [ ] 1.3 标注 file、shell、git 等仍需保留在 Web 外壳中的能力。
- [ ] 1.4 记录 Go/Gin 迁移阶段和退出条件。

## 2. Go shadow backend 骨架

- [ ] 2.1 新增 Go backend 目录结构。
- [ ] 2.2 新增独立 shadow 启动命令，监听显式地址。
- [ ] 2.3 实现 health/status 只读端点。
- [ ] 2.4 实现第一批低风险只读诊断或 read model 端点。
- [ ] 2.5 确保生产 `package.json` 脚本不接入 Go shadow。

## 3. Contract tests

- [ ] 3.1 设计可同时指向 Node 和 Go backend 的 request matrix。
- [ ] 3.2 覆盖 health/status。
- [ ] 3.3 覆盖 co/wo 状态只读 fixture。
- [ ] 3.4 覆盖静态 dist 和 SPA fallback smoke。
- [ ] 3.5 覆盖未实现 mutation/shell/file write 路由不会静默成功。

## 4. 测试代码

- [ ] 4.1 在本提案 `tests/` 目录编写真实测试，并在执行阶段同步到根测试套件。
- [ ] 4.2 新增 Go 单元测试或 smoke 测试。
- [ ] 4.3 新增 Node/Go 共享 contract 测试。
- [ ] 4.4 更新 CI 或本地验证说明，但不改变现有生产启动路径。

## 5. 验证

- [ ] 5.1 运行 Go shadow smoke test。
- [ ] 5.2 运行 Node backend 对应 contract tests。
- [ ] 5.3 运行 `pnpm run typecheck`。
- [ ] 5.4 运行 `oz validate 2026-05-13-24-铺路Go-Gin轻薄后端 --json`。
