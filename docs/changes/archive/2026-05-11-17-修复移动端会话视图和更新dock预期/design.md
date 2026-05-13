## 总体设计

本变更把问题分成两个边界处理：

```text
移动端会话视图
  +-- 根布局必须有确定高度
  +-- 中间 transcript 是唯一滚动所有者
  `-- composer 固定在工作区底部且在 safe area 内

会话消息加载
  +-- 路由会话 id 解析到正确 provider 会话
  +-- 加载成功但无消息时显示空历史状态
  `-- 加载失败时显示错误状态并保留 composer
```

桌面 dock 的新基线是：默认只显示会话主区，右侧文件栏和底部终端栏不默认展开。测试应证明默认状态、主动打开状态和会话区稳定性，而不是继续绑定旧默认布局。

## 关键决策

### 移动端只允许明确的滚动所有者

移动端页面当前有多层 `overflow-hidden` 和 `h-full`。执行阶段应检查每一层 flex 容器是否有 `min-h-0`，确保子级可以收缩到视口内。聊天页应由 `ChatMessagesPane` 或明确等价容器持有 `overflow-y-auto`，不要依赖 body 滚动。

验收重点不是 class 名，而是实际 DOM 指标：

```text
chatScroll.scrollHeight > chatScroll.clientHeight
滚动后 chatScroll.scrollTop 发生变化
composer.getBoundingClientRect().bottom <= viewportHeight
```

### composer 不能被安全区或键盘前布局裁掉

输入框区域应作为聊天 flex column 的固定尾部。执行阶段需要确认：

- 父容器有确定高度并允许 transcript 收缩。
- composer 自身不参与 transcript 滚动。
- 移动端底部 safe area 只增加内边距，不把 composer 推出可见区域。

### 空白会话必须变成明确状态

`fetchSessionMessages` 当前会把接口失败捕获后转换为空数组。这样会把“读取失败”和“历史为空”混在一起，用户看到的是空白或继续提示。执行阶段应保留错误语义，至少在 UI 上区分：

- 加载中；
- 加载成功且没有历史消息；
- 加载失败，可提示刷新或返回项目页；
- 路由占位会话尚未绑定 provider 会话。

如果 `cN` route 已经绑定真实 provider session，则消息加载必须使用真实 provider id；如果只是尚未发送首条消息的草稿，则应显示新会话/继续输入状态。

### 桌面 dock 测试按新基线更新

过期测试中“默认右 dock 和底部 dock 可见”的断言应删除或改写为：

- 默认进入桌面会话页时，会话主区可见；
- 右侧 dock 和底部 dock 默认不存在或不可见；
- 点击文件、终端、Git 后，对应 dock 出现；
- 点击 dock 按钮后，会话 transcript 和 composer 仍可见。

### 测试必须覆盖真实业务行为

执行阶段应新增或更新 Playwright 测试，优先使用 deterministic fixture：

- 一个有足够多消息的移动端会话，用来证明滚动。
- 一个有真实历史消息的会话，用来证明点开不是空白。
- 一个空历史或草稿会话，用来证明明确空状态。
- 一个接口失败场景，用来证明错误状态不是空白。

这些测试应断言用户可见行为和 DOM 尺寸，而不是只检查组件是否挂载。

## 风险与处理

- **移动端高度修复影响桌面**：把改动限制在移动端容器或通用 `min-h-0` 收缩边界，执行后跑桌面 dock 回归。
- **空状态文案影响旧测试**：用语义化 test id 或明确可访问文本固定状态，不依赖样式。
- **provider id 兼容风险**：保持 `cN` route 和 provider session id 的现有 API 契约，只修正分支选择和错误呈现。
- **iOS Safari 差异**：测试先覆盖 Chromium 移动视口；实现上优先用 `100dvh` 或既有安全区变量时需确认 PWA 模式不回退。

## 测试策略

执行阶段应在本提案 `tests/` 中先放真实测试代码，再同步到根测试目录：

- 更新旧桌面 dock 测试，证明默认 dock 不展开、主动点击后展开、会话区不消失。
- 新增移动端长会话测试，滚动 transcript 后 `scrollTop` 变化，composer 仍在 viewport 内。
- 新增移动端会话打开测试，有历史消息的会话必须渲染消息文本。
- 新增空历史/草稿状态测试，点开后显示明确空状态且 composer 可见。
- 新增消息接口失败测试，显示错误状态，不出现纯空白主区。
