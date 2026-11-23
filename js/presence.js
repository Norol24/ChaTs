import { db, fs } from "./firebase.js";

export const ONLINE_WINDOW_MS = 75 * 1000;

export function startPresence(uid) {
  const ref = fs.doc(db(), "users", uid);
  const beat = () => {
    fs.setDoc(ref, { lastActive: fs.serverTimestamp() }, { merge: true }).catch(() => {});
  };
  beat();
  const interval = setInterval(beat, 25 * 1000);
  const onVis = () => { if (document.visibilityState === "visible") beat(); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("beforeunload", () => clearInterval(interval));
}

export function millis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  return 0;
}

export function isOnline(userDoc) {
  if (!userDoc) return false;
  return Date.now() - millis(userDoc.lastActive) < ONLINE_WINDOW_MS;
}

export function presenceLabel(userDoc) {
  return isOnline(userDoc) ? "🟢 en ligne" : "⚪ hors ligne";
}
