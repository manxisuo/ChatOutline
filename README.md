## ChatOutline（浏览器扩展）

给 ChatGPT 这类“长对话流”页面增加一个**目录/搜索/快速跳转**侧边栏，解决“滚动 = 失忆”。

### 支持站点（当前）

- `chatgpt.com` / `chat.openai.com`
- `chat.deepseek.com`（策略层已接入；如遇到 DOM 结构变动可能需要再微调选择器）
- 通义千问 / 千问：`www.qianwen.com`（也预留了 `tongyi.aliyun.com` / `qianwen.aliyun.com` / `www.tongyi.com`）
- 豆包：`www.doubao.com`

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

扩展已实现“站点策略层”（`content.js` 内 `SiteStrategy`），不同站点用不同的消息识别与角色识别策略；整体尽量避免依赖脆弱的 className，但在部分站点仍需要结合 class/属性做权衡。

ChatGPT（`chatgpt.com` / `chat.openai.com`）消息识别使用多策略：

- `article[data-testid^="conversation-turn-"]`（优先）
- `[data-message-author-role]`（兜底）

DeepSeek（`chat.deepseek.com`）优先使用 `div.dad65929` + `div[data-um-id]` / `div._4f9bf79` 识别消息。

千问（`www.qianwen.com`）优先使用 `questionItem-*` / `answerItem-*` 识别消息，并从 `bubble-uo23is` / `tongyi-markdown` 抽取文本预览。

豆包（`www.doubao.com`）优先使用 `data-testid="send_message"/"receive_message"` 识别消息，并从 `data-testid="message_text_content"` 抽取文本预览。


