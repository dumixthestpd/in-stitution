/* Only the trusted host can inject an active pack into an approved child frame. */
(() => {
  "use strict";
  if (window === window.top || globalThis.__institutionFrameBridge) return;
  globalThis.__institutionFrameBridge = true;
  const wake = () => { void chrome.runtime.sendMessage({ type: "adapter:frame-wake" }).catch(() => {}); };
  chrome.runtime.onMessage.addListener((message) => { if (message.type === "flow:wake") wake(); });
  window.addEventListener("pageshow", wake);
  wake();
})();
