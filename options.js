const DEFAULT_SETTINGS = { openByDefault: false, width: 340, granularity: "pair", searchScope: "preview", prefixLength: 800 };

function get(keys) {
  return new Promise((resolve) => {
    chrome.storage?.sync?.get(keys, (res) => resolve(res || {}));
  });
}

function set(obj) {
  return new Promise((resolve) => {
    chrome.storage?.sync?.set(obj, () => resolve());
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function load() {
  const s = await get(["openByDefault", "width", "granularity", "searchScope", "prefixLength"]);
  const openByDefault = typeof s.openByDefault === "boolean" ? s.openByDefault : DEFAULT_SETTINGS.openByDefault;
  const width = typeof s.width === "number" ? s.width : DEFAULT_SETTINGS.width;
  const granularity = s.granularity === "turn" || s.granularity === "pair" ? s.granularity : DEFAULT_SETTINGS.granularity;
  const searchScope = s.searchScope === "preview" || s.searchScope === "prefix" || s.searchScope === "full" ? s.searchScope : DEFAULT_SETTINGS.searchScope;
  const prefixLength = typeof s.prefixLength === "number" ? s.prefixLength : DEFAULT_SETTINGS.prefixLength;

  document.getElementById("openByDefault").checked = openByDefault;
  document.getElementById("width").value = String(width);
  document.getElementById("granularity").value = granularity;
  document.getElementById("searchScope").value = searchScope;
  document.getElementById("prefixLength").value = String(prefixLength);
  updatePrefixLenVisibility();
}

async function save() {
  const openByDefault = !!document.getElementById("openByDefault").checked;
  const widthRaw = Number(document.getElementById("width").value || DEFAULT_SETTINGS.width);
  const width = clamp(widthRaw, 260, 520);
  const granularity = document.getElementById("granularity").value === "turn" ? "turn" : "pair";
  const searchScope = document.getElementById("searchScope").value === "full" ? "full" : document.getElementById("searchScope").value === "prefix" ? "prefix" : "preview";
  const prefixLengthRaw = Number(document.getElementById("prefixLength").value || DEFAULT_SETTINGS.prefixLength);
  const prefixLength = clamp(prefixLengthRaw, 100, 20000);

  await set({ openByDefault, width, granularity, searchScope, prefixLength });

  const status = document.getElementById("status");
  status.textContent = "已保存";
  window.setTimeout(() => (status.textContent = ""), 1200);
}

function updatePrefixLenVisibility() {
  const scope = document.getElementById("searchScope").value;
  const row = document.getElementById("prefixLenRow");
  row.style.display = scope === "prefix" ? "flex" : "none";
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("searchScope").addEventListener("change", updatePrefixLenVisibility);
load();


