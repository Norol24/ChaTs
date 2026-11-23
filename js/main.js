import { getAppConfig, saveAppConfig, parseConfigText } from "./config.js";
import { initFirebase, db, fbAuth, fs, authApi } from "./firebase.js";
import { renderAvatarSVG, OPTIONS, HAIR_STYLES, DEFAULT_AVATAR, normalizeAvatar, avatarHTML } from "./avatar.js";
import { startPresence, isOnline, presenceLabel } from "./presence.js";
import * as store from "./store.js";
import { startCall, startIncomingWatcher, stopIncomingWatcher, bindCallControls, isBusy, setActiveUser } from "./call.js";

export const me = { uid: null, name: "", email: "", doc: null };
export const state = {
  chats: [],
  friendships: [],
  incomingReqs: [],
  sentReqs: [],
  userDocs: new Map(),
  userSubs: new Map(),
  currentChat: null,
  tab: "chats",
  avatarDraft: null,
};

/* ============================ Helpers UI ============================ */

const el = id => document.getElementById(id);

export function toast(msg, ms = 2600) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

export function fmtTime(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : (ts.toMillis ? ts.toMillis() : 0);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now - d) / 86400000);
  if (days < 6) return d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function show(id) { el(id).classList.remove("hidden"); }
function hide(id) { el(id).classList.add("hidden"); }

function switchScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  show(id);
}

export function watchUser(uid) {
  if (uid === me.uid || state.userSubs.has(uid)) return;
  const unsub = fs.onSnapshot(fs.doc(db(), "users", uid), snap => {
    if (snap.exists()) {
      state.userDocs.set(snap.id, snap.data());
      if (state.tab === "friends") renderFriendsTab();
      if (state.tab === "chats") renderChatsTab();
      if (state.currentChat) renderChatHeader();
      updateChatHeaderPresence();
    }
  }, err => console.error("watchUser", err));
  state.userSubs.set(uid, unsub);
}

export function userDocOf(uid) {
  return state.userDocs.get(uid) || null;
}

/* ============================ Démarrage ============================ */

function boot() {
  bindCallControls();
  const cfg = getAppConfig();
  if (!cfg) {
    switchScreen("screen-setup");
    el("setup-save").addEventListener("click", () => {
      try {
        const parsed = parseConfigText(el("setup-config").value);
        if (!parsed.apiKey || !parsed.projectId) throw new Error("Il manque apiKey ou projectId.");
        saveAppConfig(parsed);
        location.reload();
      } catch (e) {
        const errEl = el("setup-error");
        errEl.textContent = "Config invalide : " + e.message;
        errEl.classList.remove("hidden");
      }
    });
    return;
  }
  try {
    initFirebase(cfg);
  } catch (e) {
    localStorage.removeItem("chats_firebase_config");
    location.reload();
    return;
  }
  authApi.onAuthStateChanged(fbAuth(), user => onAuth(user));
  bindStaticUI();
}

function onAuth(user) {
  if (!user) {
    stopIncomingWatcher();
    switchScreen("screen-auth");
    return;
  }
  me.uid = user.uid;
  me.email = user.email || "";
  store.ensureUserDoc(user, user.displayName || "")
    .then(docData => {
      me.doc = docData;
      me.name = docData.name || "";
      if (me.name !== (user.displayName || "")) authApi.updateProfile(user, { displayName: me.name }).catch(() => {});
      if (!docData.avatar) {
        openAvatarEditor({ firstTime: true });
        switchScreen("screen-avatar");
      } else {
        enterApp();
      }
    })
    .catch(err => {
      console.error(err);
      toast("Erreur de chargement du profil : " + err.code);
      switchScreen("screen-auth");
    });
}

function enterApp() {
  setActiveUser({ uid: me.uid, name: me.name });
  startPresence(me.uid);
  startIncomingWatcher(me.uid);
  wireDataListeners();
  switchScreen("screen-app");
  setTab(state.tab || "chats");
}

let wired = false;
function wireDataListeners() {
  if (wired) return;
  wired = true;
  store.listenChats(me.uid, chats => {
    state.chats = chats;
    for (const c of chats) {
      for (const uid of c.members || []) watchUser(uid);
    }
    if (state.tab === "chats") renderChatsTab();
    updateGlobalBadge();
  });
  store.listenFriendships(me.uid, fs0 => {
    state.friendships = fs0;
    const friendUids = friendIds();
    for (const uid of friendUids) watchUser(uid);
    if (state.tab === "friends") renderFriendsTab();
  });
  store.listenIncomingRequests(me.uid, reqs => {
    state.incomingReqs = reqs;
    if (state.tab === "friends") renderFriendsTab();
    updateGlobalBadge();
  });
  store.listenSentRequests(me.uid, reqs => {
    state.sentReqs = reqs;
    if (state.tab === "friends") renderFriendsTab();
  });
}

function friendIds() {
  const set = new Set();
  for (const f of state.friendships) for (const u of f.uids || []) if (u !== me.uid) set.add(u);
  return [...set];
}

function updateGlobalBadge() {
  const total = state.incomingReqs.length + state.chats.filter(c => chatUnread(c)).length;
  const badge = el("header-badge");
  if (total > 0) {
    badge.textContent = String(total);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function chatUnread(chat) {
  if ((chat.lastFrom || "") === me.uid) return false;
  const seen = store.seenStorage().get(chat.id);
  return (chat.lastAt || 0) > seen;
}

/* ============================ UI statique ============================ */

function bindStaticUI() {
  el("tab-login").addEventListener("click", () => switchAuthTab(true));
  el("tab-signup").addEventListener("click", () => switchAuthTab(false));

  el("form-login").addEventListener("submit", async e2 => {
    e2.preventDefault();
    const btn = el("form-login").querySelector("button");
    btn.disabled = true;
    try {
      await authApi.signInWithEmailAndPassword(fbAuth(), el("login-email").value.trim(), el("login-password").value);
    } catch (e) {
      showAuthError("login-error", authErrorMessage(e));
    } finally { btn.disabled = false; }
  });

  el("form-signup").addEventListener("submit", async e2 => {
    e2.preventDefault();
    const btn = el("form-signup").querySelector("button");
    btn.disabled = true;
    try {
      const cred = await authApi.createUserWithEmailAndPassword(fbAuth(), el("signup-email").value.trim(), el("signup-password").value);
      await authApi.updateProfile(cred.user, { displayName: el("signup-name").value.trim() });
      await store.ensureUserDoc(cred.user, el("signup-name").value.trim());
    } catch (e) {
      showAuthError("signup-error", authErrorMessage(e));
    } finally { btn.disabled = false; }
  });

  for (const btn of document.querySelectorAll(".nav-btn")) {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  }

  el("header-badge").addEventListener("click", () => setTab("friends"));

  const fab = document.createElement("button");
  fab.id = "fab-newgroup";
  fab.className = "fab";
  fab.textContent = "＋";
  fab.addEventListener("click", () => openNewGroupScreen());
  el("screen-app").appendChild(fab);

  el("chat-back").addEventListener("click", () => closeChat());
  el("btn-send").addEventListener("click", submitChatMessage);
  el("chat-input").addEventListener("keydown", e => { if (e.key === "Enter") submitChatMessage(); });
  el("chat-call-audio").addEventListener("click", () => callCurrent(false));
  el("chat-call-video").addEventListener("click", () => callCurrent(true));

  el("btn-open-camera").addEventListener("click", openCamera);
  el("camera-close").addEventListener("click", closeCamera);
  el("camera-shoot").addEventListener("click", shootPhoto);

  for (const btn of document.querySelectorAll(".back-to-app")) {
    btn.addEventListener("click", () => { switchScreen("screen-app"); setTab(state.tab); });
  }
}

function switchAuthTab(login) {
  el("tab-login").classList.toggle("active", login);
  el("tab-signup").classList.toggle("active", !login);
  el("form-login").classList.toggle("hidden", !login);
  el("form-signup").classList.toggle("hidden", login);
  hide("login-error");
  hide("signup-error");
}

function showAuthError(id, msg) {
  const e = el(id);
  e.textContent = msg;
  e.classList.remove("hidden");
}

function authErrorMessage(e) {
  const code = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "Adresse e-mail invalide.",
    "auth/user-not-found": "Aucun compte avec cet e-mail.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail.",
    "auth/weak-password": "Mot de passe trop faible (6 caractères minimum).",
    "auth/too-many-requests": "Trop d'essais. Réessaie dans un instant.",
    "auth/network-request-failed": "Problème de connexion Internet.",
  };
  return map[code] || "Erreur : " + (code || e.message);
}

/* ============================ Onglets ============================ */

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".nav-btn")) {
    b.classList.toggle("active", b.dataset.tab === tab);
  }
  el("fab-newgroup").classList.toggle("hidden", tab !== "chats");
  el("view").innerHTML = "";
  if (tab === "chats") renderChatsTab();
  else if (tab === "friends") renderFriendsTab();
  else renderProfileTab();
}

/* ---------- Onglet Discussions ---------- */

function renderChatsTab() {
  const view = el("view");
  view.innerHTML = "";
  if (!state.chats.length) {
    view.innerHTML = `<div class="empty-note">Aucune discussion pour l'instant.<br>Ajoute des amis dans l'onglet 👥 <b>Amis</b>, puis lance ta première conversation !</div>`;
    updateGlobalBadge();
    return;
  }
  const seen = store.seenStorage();
  for (const chat of state.chats) {
    const row = document.createElement("div");
    row.className = "list-row";
    let avatarHtml, name;
    if (chat.type === "group") {
      avatarHtml = `<div class="avatar-sm avatar-group">👥</div>`;
      name = chat.name || "Groupe";
    } else {
      const peerUid = (chat.members || []).find(u => u !== me.uid);
      const u = userDocOf(peerUid);
      name = u ? u.name : "…";
      avatarHtml = `<div class="avatar-sm">${avatarHTML(u ? u.avatar : null)}</div>`;
    }
    const unread = chatUnread(chat);
    const prefix = (chat.lastFrom === me.uid && chat.lastText) ? "Toi : " : "";
    row.innerHTML = `
      ${avatarHtml}
      <div class="list-main">
        <div class="list-name">${escapeHtml(name)}</div>
        <div class="list-sub">${escapeHtml(prefix + (chat.lastText || "Nouvelle discussion"))}</div>
      </div>
      <div class="list-right">
        <span class="time">${fmtTime(chat.lastAt)}</span>
        ${unread ? '<span class="new-dot"></span>' : ""}
      </div>`;
    row.addEventListener("click", () => {
      seen.set(chat.id, chat.lastAt || Date.now());
      openChatById(chat.id, chat);
    });
    view.appendChild(row);
  }
  updateGlobalBadge();
}

/* ---------- Onglet Amis ---------- */

function renderFriendsTab() {
  const view = el("view");
  view.innerHTML = "";

  const searchWrap = document.createElement("div");
  searchWrap.className = "body-pad";
  searchWrap.style.paddingBottom = "4px";
  searchWrap.innerHTML = `<input id="friend-search" type="text" placeholder="Ajouter : pseudo ou adresse e-mail…" />`;
  view.appendChild(searchWrap);
  const results = document.createElement("div");
  results.id = "search-results";
  view.appendChild(results);
  searchWrap.querySelector("#friend-search").addEventListener("input", e => runUserSearch(e.target.value, results));

  const friends = friendIds().map(uid => ({ uid, doc: userDocOf(uid) })).filter(f => f.doc);
  friends.sort((a, b) => Number(isOnline(b.doc)) - Number(isOnline(a.doc)) || a.doc.name.localeCompare(b.doc.name));

  const inReqBlock = buildRequestsBlock();
  if (inReqBlock) view.appendChild(inReqBlock);

  const sentBlock = document.createElement("div");
  if (state.sentReqs.length) {
    sentBlock.innerHTML = `<div class="section-label">Invitations envoyées (${state.sentReqs.length})</div>`;
    for (const req of state.sentReqs) {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="avatar-sm">${avatarHTML(null)}</div>
        <div class="list-main">
          <div class="list-name">${escapeHtml(req.toName || "Ami")}</div>
          <div class="list-sub">En attente d'acceptation…</div>
        </div>`;
      sentBlock.appendChild(row);
    }
    view.appendChild(sentBlock);
  }

  const friendsBlock = document.createElement("div");
  friendsBlock.innerHTML = `<div class="section-label">Mes amis (${friends.length})</div>`;
  if (!friends.length) {
    friendsBlock.innerHTML += `<div class="empty-note">Tu n'as pas encore d'amis.<br>Cherche-les ci-dessus avec leur <b>e-mail</b> ou leur <b>pseudo</b> (3 lettres minimum).</div>`;
  }
  for (const f of friends) {
    const online = isOnline(f.doc);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="avatar-sm">${avatarHTML(f.doc.avatar)}</div>
      <div class="list-main">
        <div class="list-name">${escapeHtml(f.doc.name)} <span class="${online ? "online-dot" : "offline-dot"}" title="${online ? "en ligne" : "hors ligne"}"></span></div>
        <div class="list-sub">${online ? "🟢 en ligne" : "⚪ hors ligne"}</div>
      </div>
      <div class="row-btns">
        <button class="sm-btn yellow call-friend" data-uid="${f.uid}" data-name="${escapeHtml(f.doc.name)}">📞</button>
      </div>`;
    row.addEventListener("click", e => {
      if (e.target.closest(".call-friend")) return;
      openDm(f.uid);
    });
    row.querySelector(".call-friend").addEventListener("click", () => {
      startCall({ chatId: null, chatLabel: f.doc.name, calleeUids: [f.uid], video: false });
    });
    friendsBlock.appendChild(row);
  }
  view.appendChild(friendsBlock);
}

function buildRequestsBlock() {
  if (!state.incomingReqs.length) return null;
  const block = document.createElement("div");
  block.innerHTML = `<div class="section-label">Demandes d'ami (${state.incomingReqs.length})</div>`;
  for (const req of state.incomingReqs) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="avatar-sm">${avatarHTML(null)}</div>
      <div class="list-main">
        <div class="list-name">${escapeHtml(req.fromName || "Quelqu'un")}</div>
        <div class="list-sub">veut être ton ami</div>
      </div>
      <div class="row-btns">
        <button class="sm-btn ok">Accepter</button>
        <button class="sm-btn no">Refuser</button>
      </div>`;
    row.querySelector(".ok").addEventListener("click", async () => {
      try {
        await store.acceptRequest(req);
        toast("Ami ajouté 🎉");
      } catch (e) { toast("Erreur : " + e.code); }
    });
    row.querySelector(".no").addEventListener("click", () => store.declineRequest(req));
    block.appendChild(row);
  }
  return block;
}

let searchSeq = 0;
async function runUserSearch(term, container) {
  const seq = ++searchSeq;
  const found = await store.searchUsers(term, me.uid);
  container.innerHTML = "";
  if (seq !== searchSeq || !found.length) return;
  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Résultats";
  container.appendChild(label);
  for (const u of found) {
    const alreadyFriend = friendIds().includes(u.uid);
    const sent = state.sentReqs.some(r => r.toUid === u.uid);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="avatar-sm">${avatarHTML(u.avatar)}</div>
      <div class="list-main">
        <div class="list-name">${escapeHtml(u.name)}</div>
        <div class="list-sub">${escapeHtml(u.email || "")}</div>
      </div>
      <div class="row-btns">
        <button class="sm-btn ${alreadyFriend || sent ? "no" : "yellow"}" ${alreadyFriend || sent ? "disabled" : ""}>
          ${alreadyFriend ? "Déjà ami" : sent ? "Envoyé ✓" : "＋ Ajouter"}
        </button>
      </div>`;
    const btn = row.querySelector("button");
    if (!btn.disabled) {
      btn.addEventListener("click", async () => {
        try {
          await store.sendFriendRequest(u, { uid: me.uid, name: me.name });
          btn.disabled = true;
          btn.className = "sm-btn no";
          btn.textContent = "Envoyé ✓";
          toast("Demande envoyée à " + u.name + " !");
        } catch (e) { toast("Erreur : " + e.code); }
      });
    }
    container.appendChild(row);
  }
}

/* ---------- Onglet Profil ---------- */

function renderProfileTab() {
  const view = el("view");
  view.innerHTML = `
    <div class="profile-head">
      <div class="avatar-wrap">${avatarHTML(me.doc && me.doc.avatar)}</div>
      <div class="profile-name">${escapeHtml(me.name)}</div>
      <div class="profile-mail">${escapeHtml(me.email)}</div>
    </div>
    <div class="profile-actions">
      <button id="btn-edit-avatar" class="purple-btn">😎 Modifier mon personnage</button>
      <button id="btn-share" class="purple-btn">🔗 Mon adresse pour être ajouté</button>
      <button id="btn-logout" class="purple-btn">🚪 Se déconnecter</button>
      <div class="empty-note" style="padding:16px">🎮 Les jeux arrivront dans une prochaine mise à jour !</div>
    </div>`;
  view.querySelector("#btn-edit-avatar").addEventListener("click", () => openAvatarEditor({ firstTime: false }));
  view.querySelector("#btn-share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(me.email); toast("E-mail copié ! Colle-le à un ami."); }
    catch (e) { toast(me.email); }
  });
  view.querySelector("#btn-logout").addEventListener("click", async () => {
    await authApi.signOut(fbAuth());
    location.reload();
  });
}

/* ============================ Éditeur d'avatar ============================ */

function openAvatarEditor({ firstTime }) {
  state.avatarDraft = normalizeAvatar((me.doc && me.doc.avatar) || DEFAULT_AVATAR);
  buildAvatarControls();
  refreshAvatarPreview();
  const saveBtn = el("avatar-save-btn");
  const fresh = saveBtn.cloneNode(true);
  saveBtn.replaceWith(fresh);
  fresh.addEventListener("click", async () => {
    try {
      await store.updateUserDoc(me.uid, { avatar: state.avatarDraft });
      me.doc = me.doc || {};
      me.doc.avatar = state.avatarDraft;
      if (firstTime) { enterApp(); }
      else { switchScreen("screen-app"); setTab("profile"); toast("Personnage enregistré !"); }
    } catch (e) { toast("Erreur d'enregistrement : " + e.code); }
  });
  switchScreen("screen-avatar");
}

let avatarControlsBuilt = false;
function buildAvatarControls() {
  if (avatarControlsBuilt) return;
  avatarControlsBuilt = true;
  const swatchGroups = { skin: "swatch-skin", hair: "swatch-hair", eyes: "swatch-eyes", top: "swatch-top", bg: "swatch-bg" };
  for (const [key, containerId] of Object.entries(swatchGroups)) {
    const container = el(containerId);
    for (let i = 0; i < OPTIONS[key].length; i++) {
      const s = document.createElement("div");
      s.className = "swatch";
      s.style.background = OPTIONS[key][i];
      s.dataset.key = key;
      s.dataset.index = String(i);
      s.addEventListener("click", () => {
        state.avatarDraft[key] = i;
        refreshAvatarPreview();
      });
      container.appendChild(s);
    }
  }
  const hairPicker = el("style-hair");
  for (const style of HAIR_STYLES) {
    const b = document.createElement("button");
    b.className = "style-opt";
    b.dataset.style = style.id;
    b.textContent = style.label;
    b.addEventListener("click", () => {
      state.avatarDraft.hairStyle = style.id;
      refreshAvatarPreview();
    });
    hairPicker.appendChild(b);
  }
}

function refreshAvatarPreview() {
  el("avatar-preview").innerHTML = renderAvatarSVG(state.avatarDraft);
  document.querySelectorAll(".swatch").forEach(sw => {
    sw.classList.toggle("selected", state.avatarDraft[sw.dataset.key] === Number(sw.dataset.index));
  });
  document.querySelectorAll(".style-opt").forEach(b => {
    b.classList.toggle("selected", state.avatarDraft.hairStyle === b.dataset.style);
  });
}

/* ============================ Conversation ============================ */

async function openDm(peerUid) {
  const dm = await store.getOrCreateDm(me.uid, peerUid);
  await openChatById(dm.id, await freshChat(dm.id), peerUid);
}

async function freshChat(chatId) {
  const snap = await fs.getDoc(fs.doc(db(), "chats", chatId));
  return snap.exists() ? { id: chatId, ...snap.data() } : { id: chatId, members: [me.uid], type: "dm" };
}

async function openChatById(chatId, chatData) {
  if (state.currentChat) {
    const old = state.currentChat;
    state.currentChat = null;
    if (old.unsubMsgs) old.unsubMsgs();
  }
  try { if (!chatData || !chatData.type) chatData = await freshChat(chatId); } catch (e) { console.error(e); }
  const peerUid = chatData.type === "dm" ? (chatData.members || []).find(u => u !== me.uid) : null;
  if (peerUid) watchUser(peerUid);
  state.currentChat = { id: chatId, data: chatData, peerUid, unsubMsgs: null };
  switchScreen("screen-chat");
  renderChatHeader();
  const msgs = el("chat-messages");
  msgs.innerHTML = "";
  state.currentChat.unsubMsgs = store.listenMessages(chatId, list => {
    if (!state.currentChat || state.currentChat.id !== chatId) return;
    renderMessages(list);
    msgs.scrollTop = msgs.scrollHeight;
    if (list.length) {
      const last = list[list.length - 1];
      const lastMs = last.at && last.at.toMillis ? last.at.toMillis() : (last.at || Date.now());
      store.seenStorage().set(chatId, lastMs);
      updateGlobalBadge();
    }
  });
}

function renderChatHeader() {
  const c = state.currentChat;
  if (!c) return;
  const d = c.data || {};
  if (d.type === "group") {
    el("chat-peer-avatar").innerHTML = `<div class="avatar-sm avatar-group" style="width:40px;height:40px">👥</div>`;
    el("chat-peer-name").textContent = d.name || "Groupe";
    el("chat-peer-status").textContent = (d.members || []).length + " membres";
    el("chat-peer-status").dataset.uid = "";
  } else {
    const u = userDocOf(c.peerUid);
    el("chat-peer-avatar").innerHTML = avatarHTML(u ? u.avatar : null);
    el("chat-peer-name").textContent = u ? u.name : "…";
    el("chat-peer-status").textContent = u ? presenceLabel(u) : "";
    el("chat-peer-status").dataset.uid = c.peerUid || "";
  }
}

function updateChatHeaderPresence() {
  const c = state.currentChat;
  if (!c || !c.data || c.data.type !== "dm") return;
  const u = userDocOf(c.peerUid);
  if (u) el("chat-peer-status").textContent = presenceLabel(u);
}

function closeChat() {
  if (state.currentChat && state.currentChat.unsubMsgs) state.currentChat.unsubMsgs();
  state.currentChat = null;
  switchScreen("screen-app");
  setTab(state.tab);
}

function renderMessages(list) {
  const c = state.currentChat;
  const isGroup = c.data.type === "group";
  const container = el("chat-messages");
  container.innerHTML = "";
  let lastFromShown = null;
  for (const m of list) {
    const mine = m.from === me.uid;
    const div = document.createElement("div");
    div.className = "msg " + (mine ? "me" : "them");
    let inner = "";
    if (isGroup && !mine && m.fromName !== lastFromShown) {
      inner += `<span class="msg-sender">${escapeHtml(m.fromName || "Ami")}</span>`;
      lastFromShown = m.fromName;
    }
    if (m.photo) inner += `<img class="snap" src="${m.photo}" alt="photo" loading="lazy" />`;
    if (m.text) inner += escapeHtml(m.text).replace(/\n/g, "<br>");
    if (!m.photo && !m.text) inner = "…";
    inner += `<span class="msg-time">${fmtTime(m.at)}</span>`;
    div.innerHTML = inner;
    container.appendChild(div);
  }
}

async function submitChatMessage() {
  const c = state.currentChat;
  if (!c) return;
  const input = el("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await store.sendMessage(c.id, { uid: me.uid, name: me.name }, { text, photo: null });
  } catch (e) {
    toast("Message non envoyé : " + (e.code || "erreur réseau"));
    input.value = text;
  }
}

/* ============================ Appeler depuis une conversation ============================ */

function callCurrent(video) {
  const c = state.currentChat;
  if (!c || !c.data) return;
  const d = c.data;
  if (isBusy()) { toast("Déjà en appel."); return; }
  const others = (d.members || []).filter(u => u !== me.uid);
  if (!others.length) { toast("Personne à appeler."); return; }
  const name = d.type === "group" ? (d.name || "Groupe") : ((userDocOf(c.peerUid) || {}).name || "Ami");
  startCall({ chatId: c.id, chatLabel: name, calleeUids: others, video });
}

/* ============================ Nouveau groupe ============================ */

function openNewGroupScreen() {
  const list = el("group-friends");
  list.innerHTML = "";
  el("group-name").value = "";
  const friends = friendIds().map(uid => ({ uid, doc: userDocOf(uid) })).filter(f => f.doc);
  if (!friends.length) {
    list.innerHTML = `<div class="empty-note">Ajoute d'abord des amis, puis tu pourras créer un groupe !</div>`;
  }
  for (const f of friends) {
    const label = document.createElement("label");
    label.className = "list-row";
    label.style.cursor = "pointer";
    label.innerHTML = `
      <input type="checkbox" value="${f.uid}" style="width:22px;height:22px;accent-color:#111" />
      <div class="avatar-sm">${avatarHTML(f.doc.avatar)}</div>
      <div class="list-main">
        <div class="list-name">${escapeHtml(f.doc.name)} <span class="${isOnline(f.doc) ? "online-dot" : "offline-dot"}"></span></div>
        <div class="list-sub">${isOnline(f.doc) ? "🟢 en ligne" : "⚪ hors ligne"}</div>
      </div>`;
    list.appendChild(label);
  }
  const createBtn = el("group-create");
  const fresh = createBtn.cloneNode(true);
  createBtn.replaceWith(fresh);
  fresh.addEventListener("click", async () => {
    const name = el("group-name").value.trim();
    const checked = [...list.querySelectorAll("input:checked")].map(i => i.value);
    hide("group-error");
    if (!name) { showErr("group-error", "Donne un nom à ton groupe !"); return; }
    if (!checked.length) { showErr("group-error", "Choisis au moins un ami."); return; }
    try {
      const chatId = await store.createGroup(name, checked, { uid: me.uid, name: me.name });
      switchScreen("screen-app");
      toast("Groupe créé 🎉");
      await openChatById(chatId, null);
    } catch (e) { showErr("group-error", "Erreur : " + (e.code || e.message)); }
  });
  switchScreen("screen-newgroup");
}

function showErr(id, msg) {
  const e = el(id);
  e.textContent = msg;
  e.classList.remove("hidden");
}

/* ============================ Caméra (snaps photo) ============================ */

let cameraStream = null;

async function openCamera() {
  if (!state.currentChat) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  } catch (e) {
    toast("Caméra inaccessible : autorise la caméra dans ton navigateur.");
    return;
  }
  el("camera-video").srcObject = cameraStream;
  show("camera-modal");
}

function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  hide("camera-modal");
}

async function shootPhoto() {
  const c = state.currentChat;
  if (!c || !cameraStream) return;
  const video = el("camera-video");
  const canvas = el("camera-canvas");
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  closeCamera();
  let dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  if (dataUrl.length > 800000) dataUrl = canvas.toDataURL("image/jpeg", 0.35);
  try {
    await store.sendMessage(c.id, { uid: me.uid, name: me.name }, { text: "", photo: dataUrl });
  } catch (e) {
    toast("Photo non envoyée (trop volumineuse ?) : " + (e.code || ""));
  }
}

/* ============================ Utilitaires ============================ */

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

window.__chatsAvatarFor = uid => {
  if (uid === me.uid) return avatarHTML(me.doc && me.doc.avatar);
  const u = userDocOf(uid);
  return avatarHTML(u ? u.avatar : null);
};

boot();
