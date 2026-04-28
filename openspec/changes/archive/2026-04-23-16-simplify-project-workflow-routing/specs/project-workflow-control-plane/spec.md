## MODIFIED Requirements

### Requirement: 需求工作流详情必须展示控制面阶段与子会话入口
系统 MUST 在正文区域为需求工作流提供独立详情页，展示至少 intake、planning、execution、verification、ready_for_acceptance/finalized 等阶段信息，并提供打开具体子会话的入口。工作流详情页自身的规范地址 MUST 使用 `/<project>/wN` 形式，工作流内子会话入口 MUST 打开 `/<project>/wN/cN` 形式的规范地址，而不是暴露真实子会话 ID 或依赖查询参数恢复工作流上下文。

#### Scenario: 控制面工作流详情展示阶段与子会话入口
- **WHEN** 用户点击项目中的某个需求工作流
- **THEN** 正文区显示该需求的目标、当前阶段和阶段进度
- **AND** 页面展示该需求关联的 artifact、验收结论或待处理状态
- **AND** 页面列出该需求派生的子会话入口
- **AND** 当前工作流详情地址使用 `/<project>/wN`
- **AND** 用户点击某个子会话入口后进入 `/<project>/wN/cN` 对应会话内容
