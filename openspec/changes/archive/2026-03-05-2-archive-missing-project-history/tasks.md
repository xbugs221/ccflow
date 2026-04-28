## 1. 归档索引与路径校验基础能力

- [x] 1.1 新增归档索引读写 helper（建议 `~/.claude/project-archive.json`），定义最小数据结构与默认初始化逻辑
- [x] 1.2 新增统一的路径存在性检测 helper，并约束仅 `ENOENT/ENOTDIR` 触发归档
- [x] 1.3 新增归档写入逻辑：记录 `normalizedPath`、`reason=path-missing`、`archivedAt` 与来源类型（claude/manual/codex）

## 2. 接入项目聚合与 API 返回链路

- [x] 2.1 在 `getProjects()` 的 Claude 项目分支接入“检测->归档->跳过返回”流程
- [x] 2.2 在手工项目与 Codex-only 项目分支接入同样流程，并复用同一归档 helper
- [x] 2.3 确保 `/api/projects` 仅返回未归档且路径有效项目，且归档动作不触发任何会话删除逻辑

## 3. 回归测试与验证

- [x] 3.1 增加测试：当项目路径不存在时，请求 `/api/projects` 会产生归档记录且项目不再出现在返回列表
- [x] 3.2 增加测试：归档后不会调用删除会话路径（Claude/Cursor/Codex 历史文件保持不变）
- [x] 3.3 完成手工验证脚本：删除或移动本地项目目录后刷新页面，左侧项目消失且历史文件仍可在磁盘找到
