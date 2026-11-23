import { db, fs } from "./firebase.js";

export function pairId(a, b) {
  return [a, b].sort().join("__");
}

export async function ensureUserDoc(user, fallbackName) {
  const ref = fs.doc(db(), "users", user.uid);
  const snap = await fs.getDoc(ref);
  if (snap.exists()) {
    fs.setDoc(ref, { emailLower: (user.email || "").toLowerCase() }, { merge: true }).catch(() => {});
    return snap.data();
  }
  const data = {
    uid: user.uid,
    name: fallbackName || (user.email || "invité").split("@")[0],
    nameLower: (fallbackName || (user.email || "invité").split("@")[0]).toLowerCase(),
    email: user.email || "",
    emailLower: (user.email || "").toLowerCase(),
    createdAt: fs.serverTimestamp(),
  };
  await fs.setDoc(ref, data, { merge: true });
  return data;
}

export async function updateUserDoc(uid, fields) {
  await fs.setDoc(fs.doc(db(), "users", uid), fields, { merge: true });
}

export async function getUser(uid) {
  const snap = await fs.getDoc(fs.doc(db(), "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function searchUsers(term, myUid) {
  const t = term.trim().toLowerCase();
  if (t.length < 3) return [];
  const byEmail = fs.query(fs.collection(db(), "users"), fs.where("emailLower", "==", t));
  const byName = fs.query(
    fs.collection(db(), "users"),
    fs.where("nameLower", ">=", t),
    fs.where("nameLower", "<=", t + "\uf8ff")
  );
  const [eSnap, nSnap] = await Promise.all([
    fs.getDocs(byEmail).catch(() => null),
    fs.getDocs(byName).catch(() => null),
  ]);
  const map = new Map();
  for (const snap of [eSnap, nSnap]) {
    if (!snap) continue;
    snap.forEach(d => {
      if (d.id !== myUid) map.set(d.id, { uid: d.id, ...d.data() });
    });
  }
  return [...map.values()].slice(0, 20);
}

export async function sendFriendRequest(target, me) {
  const id = pairId(me.uid, target.uid);
  const reqRef = fs.doc(db(), "friendRequests", id);
  await fs.setDoc(reqRef, {
    fromUid: me.uid,
    fromName: me.name,
    toUid: target.uid,
    toName: target.name || "",
    status: "pending",
    at: fs.serverTimestamp(),
  });
}

export function listenIncomingRequests(uid, cb) {
  const q = fs.query(
    fs.collection(db(), "friendRequests"),
    fs.where("toUid", "==", uid),
    fs.where("status", "==", "pending")
  );
  return fs.onSnapshot(q, snap => {
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    cb(reqs);
  }, err => console.error("requests", err));
}

export function listenSentRequests(uid, cb) {
  const q = fs.query(
    fs.collection(db(), "friendRequests"),
    fs.where("fromUid", "==", uid),
    fs.where("status", "==", "pending")
  );
  return fs.onSnapshot(q, snap => {
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    cb(reqs);
  }, err => console.error("sent", err));
}

export async function acceptRequest(req) {
  const batchUids = [req.fromUid, req.toUid].sort();
  await fs.setDoc(fs.doc(db(), "friendRequests", req.id), { status: "accepted" }, { merge: true });
  await fs.setDoc(fs.doc(db(), "friendships", pairId(req.fromUid, req.toUid)), {
    uids: batchUids,
    since: fs.serverTimestamp(),
  });
  await getOrCreateDm(req.fromUid, req.toUid);
}

export async function declineRequest(req) {
  await fs.deleteDoc(fs.doc(db(), "friendRequests", req.id));
}

export function listenFriendships(uid, cb) {
  const q = fs.query(
    fs.collection(db(), "friendships"),
    fs.where("uids", "array-contains", uid)
  );
  return fs.onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => console.error("friendships", err));
}

export async function getOrCreateDm(uidA, uidB) {
  const id = "dm_" + pairId(uidA, uidB);
  const ref = fs.doc(db(), "chats", id);
  const snap = await fs.getDoc(ref);
  if (!snap.exists()) {
    await fs.setDoc(ref, {
      type: "dm",
      members: [uidA, uidB].sort(),
      lastText: "",
      lastAt: 0,
      lastFrom: "",
      createdAt: fs.serverTimestamp(),
    });
  }
  return { id, data: (await fs.getDoc(ref)).data() || null };
}

export function listenChats(uid, cb) {
  const q = fs.query(
    fs.collection(db(), "chats"),
    fs.where("members", "array-contains", uid)
  );
  return fs.onSnapshot(q, snap => {
    const chats = [];
    snap.forEach(d => chats.push({ id: d.id, ...d.data() }));
    chats.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    cb(chats);
  }, err => console.error("chats", err));
}

export function listenMessages(chatId, cb) {
  const q = fs.query(
    fs.collection(db(), "chats", chatId, "messages"),
    fs.orderBy("at", "asc"),
    fs.limitToLast(200)
  );
  return fs.onSnapshot(q, snap => {
    const msgs = [];
    snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
    cb(msgs);
  }, err => console.error("messages", err));
}

export async function sendMessage(chatId, me, { text, photo }) {
  const payload = {
    from: me.uid,
    fromName: me.name || "",
    text: (text || "").slice(0, 2000),
    at: fs.serverTimestamp(),
  };
  if (photo) payload.photo = photo;
  await fs.addDoc(fs.collection(db(), "chats", chatId, "messages"), payload);
  await fs.setDoc(
    fs.doc(db(), "chats", chatId),
    { lastText: photo ? "📷 Photo" : (text || "").slice(0, 80), lastAt: Date.now(), lastFrom: me.uid },
    { merge: true }
  );
}

export async function createGroup(name, memberUids, me) {
  const members = [...new Set([me.uid, ...memberUids])].sort();
  const ref = fs.doc(fs.collection(db(), "chats"));
  await fs.setDoc(ref, {
    type: "group",
    name: name.trim().slice(0, 40) || "Groupe",
    members,
    createdBy: me.uid,
    lastText: "",
    lastAt: Date.now(),
    lastFrom: "",
    createdAt: fs.serverTimestamp(),
  });
  await fs.addDoc(fs.collection(db(), "chats", ref.id, "messages"), {
    from: me.uid,
    fromName: me.name || "",
    text: " a créé le groupe « " + name.trim() + " »",
    at: fs.serverTimestamp(),
  });
  return ref.id;
}

export async function leaveGroup(chatId, me) {
  const snap = await fs.getDoc(fs.doc(db(), "chats", chatId));
  if (!snap.exists()) return;
  const members = (snap.data().members || []).filter(u => u !== me.uid);
  await fs.updateDoc(fs.doc(db(), "chats", chatId), { members });
}

export function seenStorage() {
  return {
    get(chatId) {
      try {
        return Number(JSON.parse(localStorage.getItem("chats_seen") || "{}")[chatId] || 0);
      } catch (e) { return 0; }
    },
    set(chatId, ts) {
      try {
        const all = JSON.parse(localStorage.getItem("chats_seen") || "{}");
        all[chatId] = ts;
        localStorage.setItem("chats_seen", JSON.stringify(all));
      } catch (e) { /* noop */ }
    },
  };
}
