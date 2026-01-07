const DEFAULT_SETTINGS = { openByDefault: false, width: 340, granularity: "pair", searchScope: "preview", prefixLength: 800 };

function t(key, substitutions, fallback) {
  try {
    const msg = chrome?.i18n?.getMessage?.(key, substitutions);
    return msg || fallback || key;
  } catch {
    return fallback || key;
  }
}

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

function applyI18n() {
  document.title = t("optionsTitle", null, document.title);
  const map = [
    ["i18n-optionsTitle", "optionsTitle"],
    ["i18n-optionsIntro", "optionsIntro"],
    ["i18n-optionsOpenByDefault", "optionsOpenByDefault"],
    ["i18n-optionsWidth", "optionsWidth"],
    ["i18n-optionsGranularity", "optionsGranularity"],
    ["i18n-optionsSearchScope", "optionsSearchScope"],
    ["i18n-optionsPrefixLength", "optionsPrefixLength"],
    ["i18n-optionsHowtoTitle", "optionsHowtoTitle"],
    ["i18n-optionsHowto1", "optionsHowto1"],
    ["i18n-optionsHowto2", "optionsHowto2"],
    ["i18n-optionsHowto3", "optionsHowto3"],
    ["i18n-optionsHowto4", "optionsHowto4"]
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = t(key, null, el.textContent);
  }

  const saveBtn = document.getElementById("save");
  if (saveBtn) saveBtn.textContent = t("optionsSave", null, saveBtn.textContent);

  const gran = document.getElementById("granularity");
  if (gran) {
    const optPair = gran.querySelector("option[value='pair']");
    const optTurn = gran.querySelector("option[value='turn']");
    if (optPair) optPair.textContent = t("granularityPair", null, optPair.textContent);
    if (optTurn) optTurn.textContent = t("granularityTurn", null, optTurn.textContent);
  }

  const scope = document.getElementById("searchScope");
  if (scope) {
    const optPreview = scope.querySelector("option[value='preview']");
    const optPrefix = scope.querySelector("option[value='prefix']");
    const optFull = scope.querySelector("option[value='full']");
    if (optPreview) optPreview.textContent = t("optionsSearchScopePreview", null, optPreview.textContent);
    if (optPrefix) optPrefix.textContent = t("optionsSearchScopePrefix", null, optPrefix.textContent);
    if (optFull) optFull.textContent = t("optionsSearchScopeFull", null, optFull.textContent);
  }
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
  status.textContent = t("optionsSaved", null, "Saved");
  window.setTimeout(() => (status.textContent = ""), 1200);
}

function updatePrefixLenVisibility() {
  const scope = document.getElementById("searchScope").value;
  const row = document.getElementById("prefixLenRow");
  row.style.display = scope === "prefix" ? "flex" : "none";
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("searchScope").addEventListener("change", updatePrefixLenVisibility);
applyI18n();
load();


