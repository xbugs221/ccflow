# OpenSpec Acceptance Tests

本目录存放 OpenSpec 派生的验收测试。测试描述业务行为，不依赖实现细节；实现完成后必须全部通过。

## 24-session-management-refactor

- `test_session_management_refactor.js`: 派生自 `openspec/changes/24-session-management-refactor/specs/session-management-refactor/spec.md`，覆盖 ccflow 会话身份、并发绑定、pending 恢复、事件重放、历史校准和 steer 干预。

## 运行

```bash
node --test tests/spec/test_session_management_refactor.js
```

这些测试是验收标准。进入实现阶段后，agent 只能修改实现代码，不能修改这些测试来降低验收标准。
