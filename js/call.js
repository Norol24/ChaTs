import { db, fs } from "./firebase.js";
import { sendMessage } from "./store.js";
import { millis } from "./presence.js";

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const state = {
  me: null,
  active: null,
  pendingIncoming: null,
  unsubIncoming: null,
  unsubParticipants: null,
  unsubSignals: null,
  audioCtx: null,
  ringInt: null,
  callerTimeout: null,
};

/* ============================ Utilitaires ============================ */

function el(id) { return document.getElementById(id); }

export function toast(msg, ms = 2600) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/* ============================ Sonnerie ============================ */

function ringStart() {
  try {
    state.audioCtx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    ringStop();
    state.ringInt = setInterval(() => {
      const ctx = state.audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 640;
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.45);
    }, 900);
  } catch (e) { /* pas de son */ }
}

function ringStop() {
  if (state.ringInt) { clearInterval(state.ringInt); state.ringInt = null; }
}

export function setActiveUser(profile) {
  state.me = profile;
}

/* ============================ Démarrer un appel ============================ */

export async function startCall({ chatId, chatLabel, calleeUids, video }) {
  if (state.active) { toast("Tu es déjà dans un appel."); return; }
  if (state.pendingIncoming) { toast("Tu as un appel entrant en cours."); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch (e) {
    let detail = "";
    if (e && e.name === "NotAllowedError") {
      detail = " Autorise le micro/camera pour ce site dans ton navigateur.";
    }
    toast("Impossible d'acceder au micro." + detail, 4200);
    return;
  }
  const userDocSource = state.me;
  const callRef = fs.doc(fs.collection(db(), "calls"));
  state.active = {
    callId: callRef.id,
    video,
    chatId,
    chatLabel,
    calleeUids,
    localStream: stream,
    pcs: new Map(),
    peerStreams: new Map(),
    pendingCandidates: new Map(),
    declined: [],
    startedAt: null,
    timerInt: null,
    isCaller: true,
    callerName: userDocSource.name || "",
  };
  await fs.setDoc(callRef, {
    chatId: chatId || "",
    chatLabel: chatLabel || "",
    fromUid: state.me.uid,
    fromName: state.me.name || "",
    calleeUids,
    video,
    status: "ringing",
    at: fs.serverTimestamp(),
  });
  openOverlay();
  setCallTitle("Appel vers " + (chatLabel || "…") + "…");
  setSub("Sonnerie…");
  ringStart();
  joinCall();
  state.callerTimeout = setTimeout(async () => {
    if (state.active && state.active.isCaller && !state.active.startedAt) {
      await fs.updateDoc(fs.doc(db(), "calls", state.active.callId), { status: "ended" }).catch(() => {});
      endLocalCleanup();
      toast("Personne n'a répondu.", 3200);
    }
  }, 45000);
}

/* ============================ Rejoindre (deux côtés) ============================ */

async function joinCall() {
  const a = state.active;
  const partRef = fs.doc(db(), "calls", a.callId, "participants", state.me.uid);
  await fs.setDoc(partRef, {
    name: state.me.name || "",
    joinedAt: fs.serverTimestamp(),
  });

  state.unsubParticipants = fs.onSnapshot(fs.collection(db(), "calls", a.callId, "participants"), snap => {
    const parts = [];
    snap.forEach(d => parts.push({ uid: d.id, ...d.data() }));
    for (const gone of [...a.pcs.keys()]) {
      if (!parts.some(p => p.uid === gone)) {
        const entry = a.pcs.get(gone);
        try { entry && entry.pc.close(); } catch (e) { /* noop */ }
        a.pcs.delete(gone);
        a.peerStreams.delete(gone);
        const tileEl = document.querySelector(`#call-stage [data-uid="${gone}"]`);
        if (tileEl) tileEl.remove();
      }
    }
    if (!state.active) return;
    const me = parts.find(p => p.uid === state.me.uid);
    if (me && me.joinedAt) {
      a.myJoinedAt = millis(me.joinedAt);
      if (!a.isCaller) setSub("En appel");
    }
    for (const p of parts) {
      if (p.uid === state.me.uid) continue;
      if (!pcsHas(p.uid)) {
        const iShouldOffer =
          a.myJoinedAt && p.joinedAt && millis(p.joinedAt) >= a.myJoinedAt;
        createPeerConn(p.uid, iShouldOffer, p.name || "Ami");
      }
    }
    if (a.isCaller && !a.activeStarted && parts.length >= 2) {
      a.activeStarted = true;
      fs.updateDoc(fs.doc(db(), "calls", a.callId), { status: "active" }).catch(() => {});
    }
    if (!a.startedAt && a.pcs.size > 0) startTimer();
  });

  state.unsubSignals = fs.onSnapshot(
    fs.query(fs.collection(db(), "calls", a.callId, "signals"), fs.where("to", "==", state.me.uid)),
    snap => {
      snap.docChanges().forEach(async ch => {
        if (ch.type !== "added") return;
        const sig = { id: ch.doc.id, ...ch.doc.data() };
        await handleSignal(sig);
      });
    },
    err => console.error("signals", err)
  );
}

/* ============================ Connexions p2p ============================ */

function pcsHas(uid) { return state.active && state.active.pcs.has(uid); }

async function createPeerConn(peerUid, initiator, peerName) {
  const a = state.active;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  a.pcs.set(peerUid, { pc, name: peerName, initiator });

  a.localStream.getTracks().forEach(track => pc.addTrack(track, a.localStream));

  pc.onicecandidate = ev => {
    if (ev.candidate) {
      sendSignal(peerUid, "candidate", ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
    }
  };
  pc.ontrack = ev => {
    const stream = ev.streams[0];
    if (!stream) return;
    a.peerStreams.set(peerUid, { stream, name: peerName });
    renderPeers();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      // on attend déconnection complète ; rien à faire ici
    }
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(peerUid, "offer", { type: offer.type, sdp: offer.sdp });
  }
  renderPeers();
}

async function handleSignal(sig) {
  const a = state.active;
  if (!a) return;

  if (sig.kind === "decline") {
    onDecline(sig.from, sig.fromName || "");
    await fs.deleteDoc(fs.doc(db(), "calls", a.callId, "signals", sig.id)).catch(() => {});
    return;
  }

  const pcWrap = a.pcs.get(sig.from);
  try {
    if (sig.kind === "offer") {
      let pc = pcWrap && pcWrap.pc;
      if (!pc) {
        await createPeerConn(sig.from, false, sig.fromName || "Ami");
        pc = a.pcs.get(sig.from).pc;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
      await flushCandidates(sig.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(sig.from, "answer", { type: answer.type, sdp: answer.sdp });
    } else if (sig.kind === "answer") {
      if (pcWrap && pc.pc.signalingState !== "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
        await flushCandidates(sig.from);
      }
    } else if (sig.kind === "candidate") {
      if (pcWrap) {
        try { await pc.pc.addIceCandidate(new RTCIceCandidate(sig.payload)); } catch (e) { /* tardif */ }
      } else {
        const list = a.pendingCandidates.get(sig.from) || [];
        list.push(sig.payload);
        a.pendingCandidates.set(sig.from, list);
      }
    }
  } catch (e) {
    console.warn("signal error", e);
  }
  await fs.deleteDoc(fs.doc(db(), "calls", a.callId, "signals", sig.id)).catch(() => {});
}

async function flushCandidates(peerUid) {
  const a = state.active;
  if (!a) return;
  const list = a.pendingCandidates.get(peerUid) || [];
  a.pendingCandidates.set(peerUid, []);
  const pcWrap = a.pcs.get(peerUid);
  if (!pcWrap) return;
  for (const cand of list) {
    try { await pcWrap.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { /* tardif */ }
  }
}

async function sendSignal(toUid, kind, payload, fromName) {
  const a = state.active;
  const callId = a ? a.callId : state.pendingIncoming && state.pendingIncoming.callId;
  if (!callId) return;
  await fs.addDoc(fs.collection(db(), "calls", callId, "signals"), {
    to: toUid,
    from: state.me.uid,
    fromName: fromName || state.me.name || "",
    kind,
    payload: payload || null,
    at: fs.serverTimestamp(),
  }).catch(err => console.error("sendSignal", err));
}

function onDecline(fromUid, fromName) {
  const a = state.active;
  if (!a) return;
  a.declined.push(fromUid);
  if (a.calleeUids && a.calleeUids.length === 1) {
    toast((fromName || "Correspondant") + " a refusé l'appel.");
    hangUp(true);
  } else if (a.calleeUids && a.declined.length >= a.calleeUids.length) {
    toast("Tout le monde a refusé l'appel.");
    hangUp(true);
  } else {
    toast((fromName || "Quelqu'un") + " a refusé l'appel.");
  }
}

async function watchDeclines() { /* géré par les signals */ }

/* ============================ Interface d'appel ============================ */

function openOverlay() {
  el("call-overlay").classList.remove("hidden");
  el("call-stage").innerHTML = "";
  el("call-remote-audios").innerHTML = "";
  el("call-timer").textContent = "00:00";
  el("call-incoming").classList.add("hidden");
  if (state.active && state.active.localStream) {
    const tile = makeTile(state.me.uid, "", true);
    const v = document.createElement("video");
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.srcObject = state.active.localStream;
    tile.querySelector(".tile-video-slot").appendChild(v);
    tile.querySelector(".tile-name").textContent = "Toi";
    state.active.localTile = tile;
    mirrorIfVideo(v);
  }
}

function mirrorIfVideo(videoEl) {
  if (state.active && state.active.video) videoEl.style.transform = "scaleX(-1)";
}

function makeTile(uid, name, isLocal) {
  const t = document.createElement("div");
  t.className = "call-tile";
  t.dataset.uid = uid || "local";
  const slot = document.createElement("div");
  slot.className = "tile-video-slot";
  const nm = document.createElement("div");
  nm.className = "tile-name";
  nm.textContent = name || "";
  t.appendChild(slot);
  t.appendChild(nm);
  if (!state.active || !state.active.video) {
    const av = globalThis.__chatsAvatarFor ? globalThis.__chatsAvatarFor(uid) : null;
    if (av) { slot.innerHTML = av; t.classList.add("audio-tile"); }
  }
  el("call-stage").appendChild(t);
  return t;
}

function setPeerCountTitle() {
  const a = state.active;
  if (!a) return;
  const n = a.pcs.size + 1;
  setCallTitle(n <= 1 ? (a.chatLabel || "Appel") : (a.chatLabel || "Appel") + " · " + n + " participants");
}

function renderPeers() {
  const a = state.active;
  if (!a) return;
  setPeerCountTitle();
  for (const [uid, info] of a.peerStreams) {
    if (!a.pcs.has(uid)) { a.peerStreams.delete(uid); continue; }
    let wrap = a.pcs.get(uid);
    let tileEl = el("call-stage").querySelector(`[data-uid="${uid}"]`);
    const hasVideoTrack = info.stream.getVideoTracks().length > 0 && a.video;
    if (!tileEl) {
      if (hasVideoTrack) {
        tileEl = makeTile(uid, info.name, false);
        const v = document.createElement("video");
        v.autoplay = true; v.playsInline = true;
        v.srcObject = info.stream;
        tileEl.querySelector(".tile-video-slot").appendChild(v);
      } else {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = info.stream;
        el("call-remote-audios").appendChild(audio);
        tileEl = makeTile(uid, info.name, false);
      }
    } else if (hasVideoTrack) {
      let v = tileEl.querySelector("video");
      if (!v) {
        v = document.createElement("video");
        v.autoplay = true; v.playsInline = true;
        tileEl.querySelector(".tile-video-slot").appendChild(v);
        const aud = document.createElement("audio");
        aud.autoplay = true;
        aud.srcObject = info.stream;
        el("call-remote-audios").appendChild(aud);
      }
      v.srcObject = info.stream;
    }
    if (tileEl) {
      const pcEntry = a.pcs.get(uid);
      tileEl.classList.toggle("muted-audio", Boolean(pcEntry && pcEntry.remoteMuted));
    }
  }
}

function setCallTitle(t) { el("call-title").textContent = t; }
function setSub(t) { el("call-timer").textContent = t; }

function startTimer() {
  const a = state.active;
  if (!a || a.timerInt) return;
  state.active.startedAt = Date.now();
  a.timerInt = setInterval(() => {
    el("call-timer").textContent = fmt(Date.now() - a.startedAt);
  }, 500);
}

/* ============================ Appels entrants ============================ */

export function startIncomingWatcher(uid, nameByUid) {
  stopIncomingWatcher();
  state.unsubIncoming = fs.onSnapshot(
    fs.query(
      fs.collection(db(), "calls"),
      fs.where("calleeUids", "array-contains", uid),
      fs.where("status", "==", "ringing")
    ),
    snap => {
      let incoming = null;
      snap.forEach(d => {
        const data = { callId: d.id, ...d.data() };
        if (data.fromUid === uid) return;
        if (!incoming || (millis(data.at) > millis(incoming.at))) incoming = data;
      });
      if (incoming && !state.active) {
        state.pendingIncoming = incoming;
        el("call-incoming-name").textContent = incoming.fromName || "Quelqu'un";
        el("call-incoming-type").textContent =
          incoming.video ? "📞 Appel vidéo entrant…" : "📞 Appel entrant…";
        el("call-overlay").classList.remove("hidden");
        el("call-incoming").classList.remove("hidden");
        ringStart();
      } else if (!incoming && state.pendingIncoming) {
        const wasMine = state.pendingIncoming.callId;
        state.pendingIncoming = null;
        ringStop();
        el("call-incoming").classList.add("hidden");
        if (!state.active) el("call-overlay").classList.add("hidden");
        void wasMine;
      }
    },
    err => console.error("incoming", err)
  );
}

export function stopIncomingWatcher() {
  if (state.unsubIncoming) { state.unsubIncoming(); state.unsubIncoming = null; }
}

export async function acceptIncoming() {
  const incoming = state.pendingIncoming;
  if (!incoming) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!incoming.video });
  } catch (e) {
    let detail = e && e.name === "NotAllowedError" ? " Autorise le micro/camera dans ton navigateur." : "";
    toast("Impossible d'acceder au micro." + detail, 4200);
    await declineIncoming();
    return;
  }
  ringStop();
  el("call-incoming").classList.add("hidden");
  const calleeUids = (incoming.calleeUids || [])
    .filter(u => u !== state.me.uid)
    .concat([incoming.fromUid]);
  state.active = {
    callId: incoming.callId,
    video: !!incoming.video,
    chatId: incoming.chatId || "",
    chatLabel: incoming.fromName || "Appel",
    calleeUids,
    localStream: stream,
    pcs: new Map(),
    peerStreams: new Map(),
    pendingCandidates: new Map(),
    declined: [],
    startedAt: null,
    timerInt: null,
    isCaller: false,
  };
  await fs.updateDoc(fs.doc(db(), "calls", incoming.callId), { status: "active" }).catch(() => {});
  state.pendingIncoming = null;
  openOverlay();
  setCallTitle("Appel avec " + state.active.chatLabel);
  setSub("En appel");
  joinCall();
}

export async function declineIncoming() {
  const incoming = state.pendingIncoming;
  if (!incoming) return;
  state.pendingIncoming = null;
  ringStop();
  el("call-incoming").classList.add("hidden");
  if (!state.active) el("call-overlay").classList.add("hidden");
  const callId = incoming.callId;
  await fs.addDoc(fs.collection(db(), "calls", callId, "signals"), {
    to: incoming.fromUid,
    from: state.me.uid,
    fromName: state.me.name || "",
    kind: "decline",
    payload: null,
    at: fs.serverTimestamp(),
  }).catch(() => {});
  await fs.updateDoc(fs.doc(db(), "calls", callId), {
    declinedNames: fs.arrayUnion(state.me.name || ""),
  }).catch(() => {});
}

/* ============================ Raccrocher ============================ */

export async function hangUp(silent) {
  const a = state.active;
  if (!a) return;
  state.active = null;
  if (state.callerTimeout) { clearTimeout(state.callerTimeout); state.callerTimeout = null; }
  if (a.isCaller && !a.activeStarted) {
    await fs.updateDoc(fs.doc(db(), "calls", a.callId), { status: "ended" }).catch(() => {});
  }
  await fs.deleteDoc(fs.doc(db(), "calls", a.callId, "participants", state.me.uid)).catch(() => {});
  const duration = a.startedAt ? fmt(Date.now() - a.startedAt) : null;
  endLocalCleanup();
  el("call-overlay").classList.add("hidden");
  if (duration && a.chatId && !silent && a.isCaller) {
    const label = a.video ? "Appel vidéo" : "Appel";
    sendMessage(a.chatId, state.me, { text: label + " terminé · " + duration, photo: null })
      .catch(() => {});
  }
}

function endLocalCleanup() {
  ringStop();
  if (state.unsubParticipants) { state.unsubParticipants(); state.unsubParticipants = null; }
  if (state.unsubSignals) { state.unsubSignals(); state.unsubSignals = null; }
  const a = state.active;
  if (a) {
    a.pcs.forEach(({ pc }) => { try { pc.close(); } catch (e) { /* noop */ } });
    a.pcs.clear();
  }
  const local = state.active ? state.active.localStream : null;
  if (local) local.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* noop */ } });
}

/* ============================ Contrôles ============================ */

export function bindCallControls() {
  el("call-hangup").addEventListener("click", () => hangUp(false));
  el("call-mic").addEventListener("click", () => {
    const a = state.active;
    if (!a) return;
    const track = a.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    el("call-mic").textContent = track.enabled ? "🎙️" : "🔇";
  });
  el("call-video-toggle").addEventListener("click", () => {
    const a = state.active;
    if (!a || !a.video) { toast("Appel audio : pas de caméra."); return; }
    const track = a.localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    el("call-video-toggle").textContent = track.enabled ? "🎥" : "📷";
  });
  el("call-accept").addEventListener("click", () => acceptIncoming());
  el("call-decline").addEventListener("click", () => declineIncoming());
}

export function isBusy() { return Boolean(state.active); }
