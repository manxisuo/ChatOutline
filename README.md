## ChatOutline（浏览器扩展）

给 ChatGPT 这类“长对话流”页面增加一个**目录/搜索/快速跳转**侧边栏，解决“滚动 = 失忆”。

### 支持站点（当前）

- `chatgpt.com` / `chat.openai.com`
- `chat.deepseek.com`（策略层已接入；如遇到 DOM 结构变动可能需要再微调选择器）

### 已实现（MVP）

- **目录（Outline）**：默认 Pair（问 + 答），可切换 Turn（每条消息）
- **搜索**：支持 **预览 / 前 N 字 / 全文（实验）**（在设置页配置）
- **点击跳转 + 高亮**：滚动到对应 chat，并短暂高亮
- **进度提示**：当前第 X/总 Y
- **Back/Forward**：按滚动位置回退/前进
- **动态同步**：`MutationObserver` 增量刷新（流式输出/加载历史时能跟上）
- **快捷键**：页面内 **Alt + O** 打开/关闭目录

### 安装（Chrome / Edge）

1. 打开扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目根目录（包含 `manifest.json` 的目录）
5. 打开 `https://chatgpt.com/` 任意对话页即可看到右下角「≡」按钮

### 文件说明

- `manifest.json`：MV3 配置
- `content.js` / `content.css`：注入 UI、索引对话、监听 DOM、跳转高亮
- `options.html` / `options.js` / `options.css`：基础设置页（宽度/粒度/默认展开）

### 适配策略（当前）

当前主要针对 `chatgpt.com` / `chat.openai.com`，消息识别使用多策略（尽量避免依赖脆弱 class）：

- `article[data-testid^="conversation-turn-"]`（优先）
- `[data-message-author-role]`（兜底）

后续如果你要适配其他站（Claude / Gemini / 豆包等），建议加“站点策略层”，把 message 识别与 role 识别抽象出来。


