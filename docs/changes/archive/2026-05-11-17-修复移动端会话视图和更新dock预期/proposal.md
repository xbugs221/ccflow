## 背景

移动端会话区存在两个用户可感知问题：

- 会话页上下滚动失效，长对话不能稳定浏览，底部输入框有时被挤出视口或不可见。
- 部分会话点开后呈现空白，用户无法判断是历史为空、加载失败、路由未解析，还是消息接口返回为空。

同时，现有桌面 dock 相关 Playwright 测试仍沿用旧预期：默认进入会话页时右侧文件栏和底部终端栏应该展开。但当前产品意图已经调整为桌面会话页默认只显示会话主区，文件、终端、Git 由用户主动打开。因此历史测试需要按新意图更新，否则会把正确行为判成失败。

## 目标

- 移动端项目会话页必须保持可滚动，长对话可以上下浏览。
- 移动端底部输入框必须始终留在可见视口内，不能被布局高度或安全区挤掉。
- 打开已有会话时，如果消息可读取，必须显示真实历史消息；如果消息为空或加载失败，必须显示明确状态，不得表现为空白页。
- 更新桌面 dock 回归测试：默认不要求右侧栏和底部栏展开，只要求会话主区可见且 dock 可按按钮打开。
- 保留桌面端“文件、终端、Git 是辅助 dock，点击后会话区仍可见”的既有设计。

## 变更内容

- 审计移动端布局高度链路，重点检查 `fixed inset-0`、`h-full`、`min-h-0`、`overflow-hidden`、`overflow-y-auto` 的组合。
- 修正移动端会话页的滚动所有者，确保滚动发生在聊天 transcript 容器或明确的页面内容容器上。
- 确认移动端 composer 的布局约束和 safe area 处理，避免输入框被父容器裁切。
- 审计会话路由到消息接口的链路，特别是 `cN` 路由、provider 会话 id、`routeIndex`、`pendingProviderSessionId` 和空响应处理。
- 对加载失败、历史为空、路由占位会话分别给出可见状态，避免静默吞错后只显示空白。
- 更新过期 Playwright 测试，删除“默认 dock 必须出现”的断言，新增“默认 dock 不出现但可主动打开”的断言。
- 新增移动端真实业务回归测试，覆盖长会话滚动、composer 可见、会话历史加载和空状态。

## 范围

```text
src/components/app/AppContent.tsx
  +-- 移动端根布局高度和主内容收缩边界

src/components/main-content/view/MainContent.tsx
  +-- 移动端单视图 workspace 容器
  +-- 桌面默认 dock 预期对应的测试入口

src/components/chat/view/ChatInterface.tsx
src/components/chat/view/subcomponents/ChatMessagesPane.tsx
src/components/chat/view/subcomponents/ChatComposer.tsx
  +-- 聊天 transcript 滚动、composer 可见性、空状态呈现

src/components/chat/hooks/useChatSessionState.ts
src/utils/api.js
server/index.js
server/projects.js
  +-- 会话路由、provider id、消息加载失败和空历史语义

tests/
  `-- 更新桌面 dock 预期，新增移动端会话真实行为回归
```

## 非目标

- 不重做整体工作区视觉设计。
- 不恢复桌面端默认打开右侧文件栏或底部终端栏。
- 不引入新的移动端导航模式。
- 不改变 provider 后端协议，只修正前端路由、加载和状态展示边界。
- 不把空历史会话伪造成有消息。

## 开放问题

执行阶段需要用真实 fixture 或 mock fixture 区分三类会话：有历史消息、真实空历史、消息接口失败。若当前 fixture 数据不足，应补测试夹具，不应依赖开发者本机真实会话。
