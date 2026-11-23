const KEY = "chats_firebase_config";

export function getAppConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg && cfg.apiKey && cfg.projectId) return cfg;
    }
  } catch (e) { /* config locale illisible, on continue */ }
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) return window.FIREBASE_CONFIG;
  return null;
}

export function saveAppConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function parseConfigText(text) {
  let t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== 0 || end !== t.length - 1) {
    t = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  }
  return JSON.parse(t);
}
