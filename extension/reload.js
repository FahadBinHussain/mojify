// reload.js - dev-loop helper behind reload.html (opened by
// tools/reload-extension.ps1 after editing extension files, INCLUDING
// manifest.json). Extensions Reloader can NOT pick up manifest changes - it
// only flips chrome.management.setEnabled off/on, which never re-reads the
// manifest from disk. chrome.runtime.reload() called from INSIDE the
// extension re-loads from disk, like the edge://extensions reload button.
try {
  chrome.runtime.sendMessage({ type: "selfReload" });
  // the bg blanks this tab to about:blank within ~1s when the running copy
  // has the handler. still here after 3s = it doesn't (pre-helper version):
  // one manual reload on edge://extensions fixes that, then this is automatic.
  setTimeout(() => {
    const el = document.getElementById("status");
    if (el) el.textContent = "running version has no self-reload yet - hit reload on edge://extensions once, then this page works.";
  }, 3000);
} catch (e) {
  const el = document.getElementById("status");
  if (el) el.textContent = "reload failed: " + String(e && e.message ? e.message : e);
}
