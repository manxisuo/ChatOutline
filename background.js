chrome.runtime.onMessage.addListener((msg) => {
  try {
    if (msg && msg.type === "CO_OPEN_OPTIONS") {
      chrome.runtime.openOptionsPage();
    }
  } catch {
    // ignore
  }
});

