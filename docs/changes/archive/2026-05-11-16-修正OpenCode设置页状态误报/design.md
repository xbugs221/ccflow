## 设计目标

设置页的 OpenCode 状态必须反映用户实际能验证和使用的本机 OpenCode 环境，而不是把某个不兼容的 status 子命令失败直接翻译成 `已断开`。

最终 UI 要回答三个问题：

```text
OpenCode 状态
  |
  +-- CLI 是否可执行
  +-- 内部绑定了哪些 provider
  +-- 每个 provider 使用什么非敏感 API 信息
```

## 状态来源

优先使用 OpenCode 自身的认证列表，因为用户要看的正是 OpenCode 内部绑定状态。

```text
/api/cli/opencode/status
  |
  +-- resolveOpencodeCliPath()
  |
  +-- opencode auth list --json
  |     |
  |     +-- 成功：解析 JSON
  |     +-- 失败：继续尝试文本输出
  |
  +-- opencode auth list
        |
        +-- 解析 provider 名称
        +-- 解析认证类型，例如 api
        +-- 解析 credential file path 或来源摘要
```

`co doctor --json` 仍然用于聊天发送门禁，不应取代 OpenCode 认证列表。但状态接口可以把 `co doctor` 的 `providers.opencode` 作为补充诊断字段，帮助解释“OpenCode CLI 可用但 co provider gate 不可用”的情况。

## 返回结构

建议扩展 `/api/cli/opencode/status` 返回：

```json
{
  "available": true,
  "authenticated": true,
  "provider": "DeepSeek",
  "providers": [
    {
      "name": "DeepSeek",
      "connected": true,
      "source": "opencode",
      "authType": "api",
      "api": {
        "type": "api",
        "baseUrl": null,
        "keyPreview": null
      }
    },
    {
      "name": "Kimi For Coding",
      "connected": true,
      "source": "opencode",
      "authType": "api",
      "api": {
        "type": "api",
        "baseUrl": null,
        "keyPreview": null
      }
    }
  ],
  "error": null
}
```

字段约束：

- `available` 表示 OpenCode CLI 本身可执行。
- `authenticated` 表示存在至少一个内部绑定 provider。
- `providers[].name` 显示 OpenCode 内部 provider 名称。
- `providers[].authType` 显示认证类型，例如 `api`。
- `providers[].api` 只允许非敏感元数据。
- `keyPreview` 只能是 CLI 已经脱敏后的摘要，或后端主动脱敏后的短摘要。
- 不得返回完整 API key、token 或 secret。

## 文本输出解析

当前 OpenCode 文本输出类似：

```text
Credentials ~/.local/share/opencode/auth.json
●  DeepSeek api
●  Kimi For Coding api
└  2 credentials
```

解析规则：

- 忽略空行、边框行、统计行。
- 从 `Credentials <path>` 读取 credential source。
- 从 provider 行读取名称和最后一个认证类型词。
- provider 名称可包含空格。
- 当无法识别认证类型时，仍保留 provider 名称，`authType` 为空。

## 前端展示

OpenCode 不应复用 Codex 的 `登录为` 语义。建议展示：

```text
OpenCode
  连接状态: OpenCode 可用

  已绑定 provider
  +-- DeepSeek          API
  +-- Kimi For Coding   API

  来源: ~/.local/share/opencode/auth.json
```

状态规则：

- CLI 不可执行：显示后端错误和当前服务进程 PATH 摘要。
- CLI 可执行且有 provider：显示 `OpenCode 可用`，并列出 provider 与 API 信息。
- CLI 可执行但无 provider：显示 `OpenCode 可用，尚未绑定 provider`。
- auth list 探测失败但 CLI 可执行：显示 `OpenCode 可用，provider 状态读取失败`，并展示错误摘要，不得显示 `已断开`。

## 测试策略

执行阶段必须新增真实端到端测试，不能只做组件检查。

需要新增或更新的真实测试代码：

- server 测试：fake `opencode auth list --json` 失败，但 `opencode auth list` 文本返回两个 provider 时，状态接口返回 `available=true`、`authenticated=true`、provider 名称和 `authType=api`。
- server 测试：文本 provider 名称包含空格时解析正确，例如 `Kimi For Coding api`。
- server 测试：OpenCode CLI 不存在时，状态接口仍返回明确错误，不返回 provider。
- Playwright 端到端测试：启动测试服务时把 fake `opencode` 放进服务进程 `PATH`，不 mock `/api/cli/opencode/status`，用户打开 `设置 > 智能体 > OpenCode` 后能看到 `DeepSeek`、`Kimi For Coding` 和 `API` 信息。
- Playwright 端到端测试：fake `opencode` 可执行但无 credentials 时，设置页显示 `OpenCode 可用，尚未绑定 provider`，而不是 `已断开`。
- Playwright 端到端测试：fake `opencode auth list` 失败但 `opencode --version` 可用时，设置页显示 provider 状态读取失败，而不是误报 OpenCode CLI 断开。

这些测试覆盖真实用户路径：

```text
浏览器
  |
  v
设置页
  |
  v
真实后端接口
  |
  v
服务进程 PATH 中的 fake opencode
  |
  v
UI 展示 provider + API 信息
```

## 风险

- OpenCode 文本输出可能随版本变化。执行阶段应把解析逻辑集中在后端小函数中，并用 fixture 覆盖常见输出。
- API 信息展示容易误泄密。后端必须只返回非敏感元数据，并对任何疑似 key 的内容做脱敏。
- 现有测试中有通过 route mock `/api/cli/opencode/status` 的设置页测试。新端到端测试必须补上不 mock 后端接口的覆盖，避免再次遗漏服务端命令兼容问题。
