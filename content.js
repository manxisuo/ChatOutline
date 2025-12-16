(() => {
  const EXT_NS = "chatoutline";
  const DATA_ID = "data-chatoutline-id";

  /** @type {{openByDefault:boolean,width:number,granularity:"pair"|"turn",searchScope:"preview"|"prefix"|"full",prefixLength:number}} */
  const DEFAULT_SETTINGS = { openByDefault: false, width: 340, granularity: "pair", searchScope: "preview", prefixLength: 800 };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    open: false,
    items: /** @type {Array<any>} */ ([]),
    idToIndex: /** @type {Map<string, number>} */ (new Map()),
    activeIndex: -1,
    lastNavY: /** @type {number|null} */ (null),
    history: /** @type {number[]} */ ([]),
    future: /** @type {number[]} */ ([]),
    rebuildTimer: /** @type {number|null} */ (null),
    observing: false,
    scroller: /** @type {Window|Element} */ (window),
    scrollListenerBoundTo: /** @type {Window|Element|null} */ (null),
    onScroll: /** @type {(() => void) | null} */ (null)
  };

  const wmId = new WeakMap();

  /**
   * @typedef {"user"|"assistant"|"system"|"unknown"} Role
   * @typedef {{
   *  id: string,
   *  name: string,
   *  conversationRoot: () => Element,
   *  messageElements: () => Element[],
   *  roleForMessage: (el: Element) => Role
   * }} SiteStrategy
   */

  function uniqueElements(arr) {
    const out = [];
    const seen = new Set();
    for (const el of arr || []) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function isInsideNonConversationArea(el) {
    if (!el) return false;
    return !!el.closest("nav, aside, header, footer, [role='navigation'], [role='banner'], [role='contentinfo']");
  }

  function looksLikeMessageEl(el) {
    if (!el) return false;
    if (el.closest?.(`#${EXT_NS}-root`)) return false;
    if (isInsideNonConversationArea(el)) return false;
    const t = normalizeText(el.textContent || "");
    // Allow very short messages for DeepSeek (e.g. "飞机", "玻璃") when the wrapper clearly indicates a message.
    if (t.length < 10) {
      try {
        if (
          site?.id === "deepseek" &&
          (el.matches?.("div._9663006[data-um-id], div._4f9bf79") || el.querySelector?.("div.ds-message")) &&
          t.length >= 1
        ) {
          return true;
        }
        if (
          site?.id === "tongyi" &&
          (el.matches?.("div[class*='questionItem-'], div[class*='answerItem-']") ||
            el.closest?.("div[class*='questionItem-'], div[class*='answerItem-']")) &&
          t.length >= 1
        ) {
          return true;
        }
        if (
          site?.id === "doubao" &&
          (el.matches?.("[data-testid='send_message'], [data-testid='receive_message']") ||
            el.closest?.("[data-testid='send_message'], [data-testid='receive_message']")) &&
          t.length >= 1
        ) {
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    }
    if (t.length > 200000) return false;
    return true;
  }

  function filterToLeafCandidates(candidates) {
    // Keep "leaf" candidates (not container of other candidates) to approximate one element per message.
    const c = uniqueElements(candidates).filter(looksLikeMessageEl);
    if (c.length <= 1) return c;
    const leaf = [];
    for (const el of c) {
      let containsOther = false;
      for (const other of c) {
        if (el === other) continue;
        if (el.contains(other)) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) leaf.push(el);
    }
    return leaf.length ? leaf : c;
  }

  function detectRoleByTextHints(el) {
    const hint = (el.getAttribute?.("aria-label") || "").toLowerCase();
    const cls = (el.className || "").toString().toLowerCase();
    const dataRole =
      (el.getAttribute?.("data-role") || el.getAttribute?.("data-author") || el.getAttribute?.("data-message-role") || "")
        .toString()
        .toLowerCase();

    const all = `${hint} ${cls} ${dataRole}`;
    if (/(^|\b)(user|you|me|my|self|mine)\b/.test(all) || /(^|[^a-z])(我|用户)([^a-z]|$)/.test(all)) return "user";
    if (/(^|\b)(assistant|bot|ai|chatgpt|deepseek)\b/.test(all) || /(^|[^a-z])(助手)([^a-z]|$)/.test(all))
      return "assistant";
    return "unknown";
  }

  /** @type {SiteStrategy} */
  const chatgptStrategy = {
    id: "chatgpt",
    name: "ChatGPT",
    conversationRoot: () => {
      const main = document.querySelector("main");
      return main || document.body;
    },
    messageElements: () => {
      const turns = Array.from(document.querySelectorAll("article[data-testid^='conversation-turn-']"));
      if (turns.length > 0) return filterToLeafCandidates(turns);

      const roleNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      if (roleNodes.length > 0) {
        const wrappers = [];
        for (const n of roleNodes) {
          const w = n.closest("article") || n.closest("div");
          if (w && !wrappers.includes(w)) wrappers.push(w);
        }
        return filterToLeafCandidates(wrappers);
      }

      return filterToLeafCandidates(Array.from(document.querySelectorAll("main article, main section")).slice(0, 400));
    },
    roleForMessage: (el) => {
      const roleEl = el.closest?.("[data-message-author-role]") || el.querySelector?.("[data-message-author-role]");
      const role = roleEl?.getAttribute?.("data-message-author-role");
      if (role === "user" || role === "assistant" || role === "system") return role;
      return detectRoleByTextHints(el);
    }
  };

  /** @type {SiteStrategy} */
  const deepseekStrategy = {
    id: "deepseek",
    name: "DeepSeek",
    conversationRoot: () => {
      // Observed structure: message list wrapper
      const list = document.querySelector("div.dad65929");
      if (list) return /** @type {Element} */ (list);
      const main = document.querySelector("main");
      if (main) return /** @type {Element} */ (main);
      const app = document.querySelector("#app") || document.querySelector("[id*='app']");
      return /** @type {Element} */ (app || document.body);
    },
    messageElements: () => {
      const root = deepseekStrategy.conversationRoot();

      // Prefer stable wrappers from sample:
      // - user:      div._9663006[data-um-id]
      // - assistant: div._4f9bf79... (sometimes with extra classes like d7dc56a8)
      let primary = [];
      try {
        primary = Array.from(root.querySelectorAll(":scope > div._9663006[data-um-id], :scope > div._4f9bf79"));
      } catch {
        // Some engines may not support :scope in this context; fall back
        primary = Array.from(root.querySelectorAll("div._9663006[data-um-id], div._4f9bf79"));
      }
      const primaryFiltered = primary.filter(looksLikeMessageEl);
      if (primaryFiltered.length >= 2) return primaryFiltered.slice(0, 1200);

      // Fallback: find by inner markers but keep leaf nodes
      const fallback = Array.from(
        root.querySelectorAll("div._9663006[data-um-id], div._4f9bf79, div.ds-message, div.ds-markdown, div.md-code-block")
      );
      return filterToLeafCandidates(fallback).slice(0, 800);
    },
    roleForMessage: (el) => {
      // Strong signals from sample DOM
      if (el.matches?.("div._9663006[data-um-id], [data-um-id]")) return "user";
      if (el.matches?.("div._4f9bf79") || el.querySelector?.(".ds-markdown, .md-code-block")) return "assistant";

      const attr =
        (el.getAttribute?.("data-message-role") ||
          el.getAttribute?.("data-role") ||
          el.getAttribute?.("data-author") ||
          "")
          .toString()
          .toLowerCase();
      if (attr === "user" || attr === "human") return "user";
      if (attr === "assistant" || attr === "bot" || attr === "ai") return "assistant";
      const near = el.closest?.("[data-message-role],[data-role],[data-author],[class*='message'],[class*='chat']") || el;
      return detectRoleByTextHints(near);
    }
  };

  /** @type {SiteStrategy} */
  const tongyiStrategy = {
    id: "tongyi",
    name: "Tongyi Qianwen",
    conversationRoot: () => {
      // Observed in selector: ...scrollWrapper-LOelOS...
      const scroller = document.querySelector("div[class*='scrollWrapper-']");
      if (scroller) return /** @type {Element} */ (scroller);
      const main = document.querySelector("main");
      return /** @type {Element} */ (main || document.body);
    },
    messageElements: () => {
      const root = tongyiStrategy.conversationRoot();
      const nodes = Array.from(root.querySelectorAll("div[class*='questionItem-'], div[class*='answerItem-']"));
      // Prefer wrappers; allow short text (we'll relax filter in looksLikeMessageEl for tongyi)
      const filtered = filterToLeafCandidates(nodes);
      if (filtered.length >= 2) return filtered.slice(0, 1200);
      return filtered;
    },
    roleForMessage: (el) => {
      const cls = (el.className || "").toString();
      if (cls.includes("questionItem-")) return "user";
      if (cls.includes("answerItem-")) return "assistant";
      const q = el.closest?.("div[class*='questionItem-']");
      if (q) return "user";
      const a = el.closest?.("div[class*='answerItem-']");
      if (a) return "assistant";
      return detectRoleByTextHints(el);
    }
  };

  /** @type {SiteStrategy} */
  const doubaoStrategy = {
    id: "doubao",
    name: "Doubao",
    conversationRoot: () => {
      // Observed container in selector: ...scroll-view-... container-... reverse-...
      const scroller = document.querySelector("div[class*='scroll-view-']");
      if (scroller) return /** @type {Element} */ (scroller);
      const main = document.querySelector("main");
      return /** @type {Element} */ (main || document.body);
    },
    messageElements: () => {
      const root = doubaoStrategy.conversationRoot();
      const nodes = Array.from(root.querySelectorAll("[data-testid='send_message'], [data-testid='receive_message']"));
      // These nodes are already message wrappers; keep them
      const filtered = filterToLeafCandidates(nodes);
      if (filtered.length >= 2) return filtered.slice(0, 1500);
      return filtered;
    },
    roleForMessage: (el) => {
      const tid = (el.getAttribute?.("data-testid") || "").toString();
      if (tid === "send_message") return "user";
      if (tid === "receive_message") return "assistant";
      const send = el.closest?.("[data-testid='send_message']");
      if (send) return "user";
      const recv = el.closest?.("[data-testid='receive_message']");
      if (recv) return "assistant";
      return detectRoleByTextHints(el);
    }
  };

  /** @type {SiteStrategy} */
  const genericStrategy = {
    id: "generic",
    name: "Generic",
    conversationRoot: () => {
      const main = document.querySelector("main");
      return main || document.body;
    },
    messageElements: () => {
      const root = genericStrategy.conversationRoot();
      const candidates = Array.from(root.querySelectorAll("article, li, section, div"));
      const scored = candidates
        .map((el) => ({ el, len: normalizeText(el.textContent || "").length }))
        .filter((x) => x.len >= 12 && x.len <= 120000)
        .sort((a, b) => b.len - a.len)
        .slice(0, 300)
        .map((x) => x.el);
      return filterToLeafCandidates(scored).slice(0, 400);
    },
    roleForMessage: (el) => detectRoleByTextHints(el)
  };

  /** @returns {SiteStrategy} */
  function getSiteStrategy() {
    const host = (location.host || "").toLowerCase();
    if (host === "chat.deepseek.com") return deepseekStrategy;
    if (
      host === "tongyi.aliyun.com" ||
      host === "qianwen.aliyun.com" ||
      host === "www.tongyi.com" ||
      host === "www.qianwen.com"
    )
      return tongyiStrategy;
    if (host === "www.doubao.com") return doubaoStrategy;
    if (host === "chatgpt.com" || host === "chat.openai.com") return chatgptStrategy;
    return genericStrategy;
  }

  const site = getSiteStrategy();

  function hash32(str) {
    // FNV-1a 32bit
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage?.sync?.get(keys, (res) => resolve(res || {}));
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage?.sync?.set(obj, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function isProbablyHeaderFixed(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "sticky") return false;
    const r = el.getBoundingClientRect();
    return r.top <= 1 && r.height > 30;
  }

  function getHeaderOffset() {
    // Heuristic: choose the tallest fixed/sticky header near top
    const candidates = Array.from(document.querySelectorAll("header, [role='banner']"));
    let best = 0;
    for (const el of candidates) {
      if (!isProbablyHeaderFixed(el)) continue;
      const r = el.getBoundingClientRect();
      best = Math.max(best, Math.ceil(r.height));
    }
    return clamp(best, 0, 140);
  }

  function normalizeText(s) {
    return (s || "")
      .replace(/\s+/g, " ")
      .replace(/\u200B/g, "")
      .trim();
  }

  function stripLeadingRolePrefixes(s) {
    let t = (s || "").trim();
    // Common UI prefixes across chat UIs (CN + EN). Keep conservative to avoid stripping real content.
    t = t.replace(
      /^(?:你说|我说|用户说|助手说|ChatGPT说|ChatGPT 说|Assistant says|Assistant|User says|User|You said|You|System)\s*[:：]\s*/i,
      ""
    );
    return t.trim();
  }

  function pickPreviewFromText(text) {
    const t = stripLeadingRolePrefixes(normalizeText(text));
    if (!t) return "";
    // Prefer first "sentence-ish" chunk
    return t.length > 90 ? t.slice(0, 90) + "…" : t;
  }

  function buildSearchTextFromRaw(rawText) {
    const t = stripLeadingRolePrefixes(normalizeText(rawText));
    if (!t) return "";
    if (state.settings.searchScope === "full") return t;
    const n = state.settings.searchScope === "prefix" ? clamp(state.settings.prefixLength || 0, 100, 20000) : 90;
    return t.length > n ? t.slice(0, n) : t;
  }

  function extractRawTextForTurn(el, role) {
    // Site-specific extraction to avoid toolbar/button text pollution.
    try {
      if (site?.id === "tongyi") {
        const q = el.matches?.("div[class*='questionItem-']") ? el : el.closest?.("div[class*='questionItem-']");
        const a = el.matches?.("div[class*='answerItem-']") ? el : el.closest?.("div[class*='answerItem-']");
        if (role === "user" && q) {
          return q.querySelector?.("div.bubble-uo23is")?.textContent || q.textContent || "";
        }
        if (role === "assistant" && a) {
          return (
            a.querySelector?.("div.tongyi-markdown")?.textContent ||
            a.querySelector?.("div.contentBox-KuohQu")?.textContent ||
            a.textContent ||
            ""
          );
        }
      }
      if (site?.id === "deepseek") {
        const userWrap = el.matches?.("div._9663006[data-um-id]") ? el : el.closest?.("div._9663006[data-um-id]");
        if (role === "user" && userWrap) {
          return userWrap.querySelector?.("div.fbb737a4")?.textContent || userWrap.textContent || "";
        }
      }
      if (site?.id === "doubao") {
        const msg = el.matches?.("[data-testid='send_message'], [data-testid='receive_message']")
          ? el
          : el.closest?.("[data-testid='send_message'], [data-testid='receive_message']");
        if (msg) {
          const text = msg.querySelector?.("[data-testid='message_text_content']")?.textContent?.trim();
          if (text) return text;
          // Image / rich content fallback: count images
          const imgContent = msg.querySelector?.("[data-testid='message_image_content']");
          if (imgContent) {
            const n = imgContent.querySelectorAll("img").length;
            return n > 0 ? `图片（${n} 张）` : "图片";
          }
          return msg.textContent || "";
        }
      }
    } catch {
      // ignore
    }
    return el.textContent || "";
  }

  function elHasCode(el) {
    return !!el.querySelector("pre, code");
  }

  function stableIdFor(el, role, idx, preview) {
    if (!el) return `co-${role}-${idx}`;
    const existing = el.getAttribute(DATA_ID);
    if (existing) return existing;
    const cached = wmId.get(el);
    if (cached) return cached;
    const sig = `${role}|${idx}|${preview}|${(el.textContent || "").length}`;
    const id = `co-${role}-${idx}-${hash32(sig)}`;
    wmId.set(el, id);
    try {
      el.setAttribute(DATA_ID, id);
    } catch {
      // ignore
    }
    return id;
  }

  function findConversationRoot() {
    return site.conversationRoot();
  }

  function isScrollableElement(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const s = getComputedStyle(el);
    const oy = s.overflowY;
    if (!(oy === "auto" || oy === "scroll" || oy === "overlay")) return false;
    return el.scrollHeight > el.clientHeight + 40;
  }

  function findScrollableAncestor(startEl) {
    let el = startEl;
    while (el && el !== document.documentElement) {
      if (el.closest?.(`#${EXT_NS}-root`)) return null;
      if (isScrollableElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function resolveScrollerFromTarget(targetEl) {
    const sc = targetEl ? findScrollableAncestor(targetEl) : null;
    return sc || window;
  }

  function getScrollTop() {
    return state.scroller === window ? window.scrollY : /** @type {Element} */ (state.scroller).scrollTop;
  }

  function scrollToTop(behavior) {
    if (state.scroller === window) window.scrollTo({ top: 0, behavior });
    else /** @type {Element} */ (state.scroller).scrollTo({ top: 0, behavior });
  }

  function scrollToBottom(behavior) {
    if (state.scroller === window) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
    } else {
      const el = /** @type {Element} */ (state.scroller);
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }

  function bindScrollListener() {
    const target = state.scroller || window;
    if (state.scrollListenerBoundTo === target && state.onScroll) return;

    // unbind old
    if (state.scrollListenerBoundTo && state.onScroll) {
      state.scrollListenerBoundTo.removeEventListener("scroll", state.onScroll);
    }

    const handler = () => {
      if (!state.items.length) return;
      updateActiveFromViewport();
      syncActiveUI();
    };
    target.addEventListener("scroll", handler, { passive: true });
    state.scrollListenerBoundTo = target;
    state.onScroll = handler;
  }

  function detectRoleForMessageEl(el) {
    return site.roleForMessage(el);
  }

  function findMessageElements() {
    return site.messageElements();
  }

  function buildTurns() {
    const els = findMessageElements();
    const turns = [];
    let idx = 0;
    for (const el of els) {
      // Avoid capturing our own UI
      if (el.closest?.(`#${EXT_NS}-root`)) continue;
      const role = detectRoleForMessageEl(el);
      const raw = extractRawTextForTurn(el, role);
      const preview = pickPreviewFromText(raw);
      if (!preview) continue;
      const searchText = buildSearchTextFromRaw(raw);
      const id = stableIdFor(el, role, idx++, preview);
      turns.push({
        id,
        role,
        el,
        preview,
        searchText,
        hasCode: elHasCode(el)
      });
    }
    return turns;
  }

  function buildPairsFromTurns(turns) {
    /** @type {Array<{id:string,user?:any,assistant?:any,preview:string,hasCode:boolean,targetEl:Element}>} */
    const pairs = [];
    let i = 0;
    while (i < turns.length) {
      const t = turns[i];
      if (t.role === "user") {
        const next = turns[i + 1];
        if (next && next.role === "assistant") {
          pairs.push({
            id: `pair-${t.id}__${next.id}`,
            user: t,
            assistant: next,
            preview: t.preview || next.preview,
            hasCode: t.hasCode || next.hasCode,
            targetEl: t.el
          });
          i += 2;
          continue;
        }
        pairs.push({
          id: `pair-${t.id}`,
          user: t,
          assistant: undefined,
          preview: t.preview,
          hasCode: t.hasCode,
          targetEl: t.el
        });
        i += 1;
        continue;
      }

      // orphan assistant/system/unknown
      pairs.push({
        id: `pair-${t.id}`,
        user: undefined,
        assistant: t,
        preview: t.preview,
        hasCode: t.hasCode,
        targetEl: t.el
      });
      i += 1;
    }
    return pairs;
  }

  function createUI() {
    if (document.getElementById(`${EXT_NS}-root`)) return;

    const root = document.createElement("div");
    root.id = `${EXT_NS}-root`;

    const fab = document.createElement("button");
    fab.id = `${EXT_NS}-fab`;
    fab.type = "button";
    fab.title = "ChatOutline：目录";
    fab.innerHTML = "≡";

    const panel = document.createElement("div");
    panel.id = `${EXT_NS}-panel`;
    panel.setAttribute("data-open", "false");

    const header = document.createElement("div");
    header.className = "co-header";

    const titlebar = document.createElement("div");
    titlebar.className = "co-titlebar";
    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "2px";

    const title = document.createElement("div");
    title.className = "co-title";
    title.textContent = "ChatOutline";
    const subtitle = document.createElement("div");
    subtitle.className = "co-subtitle";
    subtitle.id = `${EXT_NS}-subtitle`;
    subtitle.textContent = "正在索引…";
    left.appendChild(title);
    left.appendChild(subtitle);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "关闭";
    closeBtn.className = "co-select";

    titlebar.appendChild(left);
    titlebar.appendChild(closeBtn);

    const row1 = document.createElement("div");
    row1.className = "co-row";
    const search = document.createElement("input");
    search.className = "co-input";
    search.id = `${EXT_NS}-search`;
    search.type = "search";
    search.placeholder = "搜索";

    row1.appendChild(search);

    const row2 = document.createElement("div");
    row2.className = "co-row";
    const gran = document.createElement("select");
    gran.className = "co-select";
    gran.id = `${EXT_NS}-granularity`;
    gran.innerHTML = `
      <option value="pair">粒度：Pair（问+答）</option>
      <option value="turn">粒度：Turn（每条消息）</option>
    `;
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新";
    refresh.className = "co-select";
    row2.appendChild(gran);
    row2.appendChild(refresh);

    header.appendChild(titlebar);
    header.appendChild(row1);
    header.appendChild(row2);

    const list = document.createElement("div");
    list.className = "co-list";
    list.id = `${EXT_NS}-list`;

    const footer = document.createElement("div");
    footer.className = "co-footer";
    const progress = document.createElement("div");
    progress.id = `${EXT_NS}-progress`;
    progress.textContent = "—";

    const actions = document.createElement("div");
    actions.className = "co-actions";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = "Back";
    const forwardBtn = document.createElement("button");
    forwardBtn.type = "button";
    forwardBtn.textContent = "Forward";
    const topBtn = document.createElement("button");
    topBtn.type = "button";
    topBtn.textContent = "Top";
    const bottomBtn = document.createElement("button");
    bottomBtn.type = "button";
    bottomBtn.textContent = "Bottom";
    actions.appendChild(backBtn);
    actions.appendChild(forwardBtn);
    actions.appendChild(topBtn);
    actions.appendChild(bottomBtn);

    footer.appendChild(progress);
    footer.appendChild(actions);

    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(footer);

    root.appendChild(fab);
    root.appendChild(panel);
    document.documentElement.appendChild(root);

    // Events
    fab.addEventListener("click", () => setOpen(!state.open, true));
    closeBtn.addEventListener("click", () => setOpen(false, true));
    refresh.addEventListener("click", () => scheduleRebuild(0));
    search.addEventListener("input", () => renderList());
    gran.addEventListener("change", async () => {
      const val = gran.value === "turn" ? "turn" : "pair";
      state.settings.granularity = val;
      await storageSet({ granularity: val });
      scheduleRebuild(0);
    });

    topBtn.addEventListener("click", () => scrollToTop("smooth"));
    bottomBtn.addEventListener("click", () => scrollToBottom("smooth"));
    backBtn.addEventListener("click", () => navBack());
    forwardBtn.addEventListener("click", () => navForward());

    // Keyboard shortcut: Alt+O
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setOpen(!state.open, true);
      }
      if (state.open && e.key === "Escape") {
        setOpen(false, true);
      }
    });
  }

  function updateSearchPlaceholder() {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`${EXT_NS}-search`));
    if (!input) return;
    const scope = state.settings.searchScope;
    if (scope === "full") {
      input.placeholder = "搜索（全文·实验）";
      return;
    }
    if (scope === "prefix") {
      const n = clamp(state.settings.prefixLength || 0, 100, 20000);
      input.placeholder = `搜索（前 ${n} 字）`;
      return;
    }
    input.placeholder = "搜索（预览）";
  }

  function setOpen(open, persist) {
    state.open = !!open;
    const panel = document.getElementById(`${EXT_NS}-panel`);
    if (panel) panel.setAttribute("data-open", state.open ? "true" : "false");
    if (persist) storageSet({ openByDefault: state.open }).catch(() => {});
  }

  function setWidth(px) {
    const panel = document.getElementById(`${EXT_NS}-panel`);
    if (panel) panel.style.setProperty("--co-width", `${px}px`);
  }

  function navPushCurrent() {
    state.history.push(getScrollTop());
    state.future.length = 0;
    if (state.history.length > 50) state.history.shift();
  }

  function navBack() {
    if (state.history.length === 0) return;
    const cur = getScrollTop();
    const prev = state.history.pop();
    state.future.push(cur);
    if (state.scroller === window) window.scrollTo({ top: prev, behavior: "smooth" });
    else /** @type {Element} */ (state.scroller).scrollTo({ top: prev, behavior: "smooth" });
  }

  function navForward() {
    if (state.future.length === 0) return;
    const cur = getScrollTop();
    const next = state.future.pop();
    state.history.push(cur);
    if (state.scroller === window) window.scrollTo({ top: next, behavior: "smooth" });
    else /** @type {Element} */ (state.scroller).scrollTo({ top: next, behavior: "smooth" });
  }

  function scrollToEl(el) {
    if (!el) return;
    navPushCurrent();
    // Ensure scroller matches the target's scroll container (ChatGPT often scrolls inside a div, not window).
    state.scroller = resolveScrollerFromTarget(el);
    bindScrollListener();

    // Bring into view first (best-effort)
    try {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      // ignore
    }

    // Then adjust by header offset within the actual scroll context.
    const headerOffset = getHeaderOffset();
    window.setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const desiredTop = headerOffset + 12;
      const delta = rect.top - desiredTop;
      if (Math.abs(delta) < 2) {
        highlightEl(el);
        return;
      }
      if (state.scroller === window) window.scrollBy({ top: delta, behavior: "smooth" });
      else /** @type {Element} */ (state.scroller).scrollBy({ top: delta, behavior: "smooth" });
      highlightEl(el);
    }, 60);
  }

  function highlightEl(el) {
    try {
      el.classList.add("chatoutline-highlight");
      window.setTimeout(() => el.classList.remove("chatoutline-highlight"), 1300);
    } catch {
      // ignore
    }
  }

  function currentSearchQuery() {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`${EXT_NS}-search`));
    return normalizeText(input?.value || "");
  }

  function renderList() {
    const list = document.getElementById(`${EXT_NS}-list`);
    const subtitle = document.getElementById(`${EXT_NS}-subtitle`);
    const progress = document.getElementById(`${EXT_NS}-progress`);
    const gran = /** @type {HTMLSelectElement|null} */ (document.getElementById(`${EXT_NS}-granularity`));
    if (!list || !subtitle || !progress) return;

    if (gran) gran.value = state.settings.granularity;

    const q = currentSearchQuery().toLowerCase();
    const items = state.items;
    const filtered = q
      ? items.filter((it) => (it.searchText || it.preview || "").toLowerCase().includes(q))
      : items.slice();

    subtitle.textContent = `共 ${items.length} 项 · 显示 ${filtered.length} 项`;
    progress.textContent =
      state.activeIndex >= 0 ? `当前 ${state.activeIndex + 1}/${items.length}` : `—/${items.length}`;

    list.textContent = "";
    for (const it of filtered) {
      const div = document.createElement("div");
      div.className = "co-item";
      div.setAttribute("data-id", it.id);
      div.setAttribute("data-kind", it.kind);
      div.setAttribute("data-role", it.kind === "turn" ? it.role : "pair");
      div.setAttribute("data-active", it.index === state.activeIndex ? "true" : "false");

      const top = document.createElement("div");
      top.className = "co-item-top";
      const idx = document.createElement("div");
      idx.className = "co-index";
      idx.textContent = `#${it.index + 1}`;

      const badges = document.createElement("div");
      badges.className = "co-badges";
      const badgeRole = document.createElement("div");
      badgeRole.className = "co-badge";
      badgeRole.textContent = it.kind === "turn" ? it.role : "Pair";
      badges.appendChild(badgeRole);
      if (it.hasCode) {
        const b = document.createElement("div");
        b.className = "co-badge";
        b.textContent = "code";
        badges.appendChild(b);
      }

      top.appendChild(idx);
      top.appendChild(badges);

      const text = document.createElement("div");
      text.className = "co-text";
      text.textContent = it.preview || "(空)";

      div.appendChild(top);
      div.appendChild(text);

      div.addEventListener("click", () => {
        const target = it.targetEl;
        if (target) scrollToEl(target);
      });

      list.appendChild(div);
    }
  }

  function rebuildIndex() {
    const turns = buildTurns();
    let items;
    if (state.settings.granularity === "turn") {
      items = turns.map((t, index) => ({
        kind: "turn",
        id: t.id,
        index,
        role: t.role,
        preview: t.preview,
        searchText: t.searchText || t.preview,
        hasCode: t.hasCode,
        targetEl: t.el
      }));
    } else {
      const pairs = buildPairsFromTurns(turns);
      items = pairs.map((p, index) => ({
        kind: "pair",
        id: p.id,
        index,
        role: "pair",
        preview: p.preview,
        searchText: ((p.user?.searchText || "") + "\n" + (p.assistant?.searchText || "")).trim() || p.preview,
        hasCode: p.hasCode,
        targetEl: p.targetEl
      }));
    }
    state.items = items;
    state.idToIndex = new Map(items.map((it) => [it.id, it.index]));
    state.scroller = resolveScrollerFromTarget(items[0]?.targetEl || null);
    bindScrollListener();
    updateActiveFromViewport();
    renderList();
  }

  function scheduleRebuild(delayMs) {
    if (state.rebuildTimer != null) window.clearTimeout(state.rebuildTimer);
    state.rebuildTimer = window.setTimeout(() => {
      state.rebuildTimer = null;
      rebuildIndex();
    }, delayMs);
  }

  function updateActiveFromViewport() {
    const items = state.items;
    if (!items || items.length === 0) {
      state.activeIndex = -1;
      return;
    }
    const headerOffset = getHeaderOffset();
    const yLine = headerOffset + 24; // viewport Y line
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      const el = items[i].targetEl;
      if (!el) continue;
      const topInViewport = el.getBoundingClientRect().top;
      const dist = Math.abs(topInViewport - yLine);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    state.activeIndex = bestIdx;
  }

  function syncActiveUI() {
    const list = document.getElementById(`${EXT_NS}-list`);
    const progress = document.getElementById(`${EXT_NS}-progress`);
    if (progress) {
      progress.textContent =
        state.activeIndex >= 0 ? `当前 ${state.activeIndex + 1}/${state.items.length}` : `—/${state.items.length}`;
    }
    if (!list) return;
    // Update only visible nodes: cheap pass
    for (const child of Array.from(list.children)) {
      const id = child.getAttribute?.("data-id");
      if (!id) continue;
      const idx = state.idToIndex.get(id);
      if (typeof idx !== "number") continue;
      child.setAttribute("data-active", idx === state.activeIndex ? "true" : "false");
    }
  }

  function attachObservers() {
    if (state.observing) return;
    state.observing = true;

    const root = findConversationRoot();
    const mo = new MutationObserver((mutations) => {
      // Ignore mutations triggered by our own UI
      for (const m of mutations) {
        if (m.target && m.target.nodeType === 1) {
          const el = /** @type {Element} */ (m.target);
          if (el.closest?.(`#${EXT_NS}-root`)) return;
        }
      }
      scheduleRebuild(250);
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    // Note: ChatGPT often scrolls inside an inner container, so we bind the scroll listener dynamically.
    bindScrollListener();
  }

  async function init() {
    // Only run on chat-like pages; still allow manual refresh.
    createUI();

    const stored = await storageGet(["openByDefault", "width", "granularity", "searchScope", "prefixLength"]);
    state.settings.openByDefault =
      typeof stored.openByDefault === "boolean" ? stored.openByDefault : DEFAULT_SETTINGS.openByDefault;
    state.settings.width = typeof stored.width === "number" ? stored.width : DEFAULT_SETTINGS.width;
    state.settings.granularity =
      stored.granularity === "turn" || stored.granularity === "pair" ? stored.granularity : DEFAULT_SETTINGS.granularity;
    state.settings.searchScope =
      stored.searchScope === "preview" || stored.searchScope === "prefix" || stored.searchScope === "full"
        ? stored.searchScope
        : DEFAULT_SETTINGS.searchScope;
    state.settings.prefixLength = typeof stored.prefixLength === "number" ? stored.prefixLength : DEFAULT_SETTINGS.prefixLength;

    setWidth(clamp(state.settings.width, 260, 520));
    setOpen(!!state.settings.openByDefault, false);
    updateSearchPlaceholder();

    // Apply changes live when user saves options (no refresh needed).
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "sync") return;
        let needRebuild = false;
        let needPlaceholder = false;
        if (changes.width && typeof changes.width.newValue === "number") {
          state.settings.width = changes.width.newValue;
          setWidth(clamp(state.settings.width, 260, 520));
        }
        if (changes.openByDefault && typeof changes.openByDefault.newValue === "boolean") {
          state.settings.openByDefault = changes.openByDefault.newValue;
        }
        if (changes.granularity && (changes.granularity.newValue === "pair" || changes.granularity.newValue === "turn")) {
          state.settings.granularity = changes.granularity.newValue;
          needRebuild = true;
        }
        if (changes.searchScope && (changes.searchScope.newValue === "preview" || changes.searchScope.newValue === "prefix" || changes.searchScope.newValue === "full")) {
          state.settings.searchScope = changes.searchScope.newValue;
          needRebuild = true;
          needPlaceholder = true;
        }
        if (changes.prefixLength && typeof changes.prefixLength.newValue === "number") {
          state.settings.prefixLength = changes.prefixLength.newValue;
          if (state.settings.searchScope === "prefix") needRebuild = true;
          if (state.settings.searchScope === "prefix") needPlaceholder = true;
        }
        if (needPlaceholder) updateSearchPlaceholder();
        if (needRebuild) scheduleRebuild(0);
      });
    } catch {
      // ignore
    }

    attachObservers();
    scheduleRebuild(0);
  }

  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();


