/* ============================================================
   5imulites — live viewer chat (talk only). Directing an agent lives in the
   "Direct a mind" panel below (board.js). Server enforces profanity (1-min mute),
   a no-"calls" filter (contract addresses / promo links are dropped), and rate
   limiting. Operators (?admin=KEY) can delete any message or clear the chat.
   ============================================================ */
(function () {
  const C = window.FIVE || {};
  const $ = (id) => document.getElementById(id);
  const feed = $("chatFeed"), input = $("chatInput"), form = $("chatForm"), statusEl = $("chatStatus");
  if (!feed || !form) return;

  function adminKey() {
    const u = new URLSearchParams(location.search).get("admin");
    if (u) { try { localStorage.setItem("5im-admin", u); } catch (e) {} return u; }
    try { return localStorage.getItem("5im-admin") || ""; } catch (e) { return ""; }
  }

  // chat is wallet-gated: a connected Phantom wallet is required to post.
  function currentWallet() {
    if (window.FIVE_WALLET) return window.FIVE_WALLET;
    try { if (window.solana && window.solana.isConnected && window.solana.publicKey) return window.solana.publicKey.toString(); } catch (e) {}
    return null;
  }

  const S = {
    clientId: Math.random().toString(36).slice(2),
    handle: localStorage.getItem("5im-handle") || ("guest-" + Math.random().toString(36).slice(2, 6)),
    mutedUntil: 0,
    socket: null,
    admin: adminKey(),
    wallet: currentWallet(),
    mods: [],      // mod wallets, from /api/prompts/config
    isMod: false,  // this wallet is one of them
  };
  localStorage.setItem("5im-handle", S.handle);

  function updateGate() {
    const ok = !!S.wallet;
    if (input) { input.disabled = !ok; input.placeholder = ok ? "Say something…" : "Connect your wallet to chat"; }
    const send = $("chatSend"); if (send) send.disabled = !ok;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const setStatus = (m, k) => { if (statusEl) { statusEl.textContent = m || ""; statusEl.className = "chat__status" + (k ? " is-" + k : ""); } };

  let atBottom = true;
  feed.addEventListener("scroll", () => { atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40; });
  function add(html, cls, id) {
    const empty = feed.querySelector(".chat__empty"); if (empty) empty.remove();
    const row = document.createElement("div");
    row.className = "cmsg" + (cls ? " " + cls : "");
    if (id) row.dataset.id = id;
    row.innerHTML = html;
    feed.appendChild(row);
    while (feed.childElementCount > 140) feed.firstElementChild.remove();
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }
  const canMod = () => !!S.admin || S.isMod;
  function addChat(who, text, mine, id) {
    const del = canMod() ? `<button class="cmsg__del" data-del="${esc(id)}" title="Delete message">✕</button>` : "";
    add(`<span class="cmsg__who">${esc(who)}</span><span class="cmsg__txt">${esc(text)}</span>${del}`, mine ? "is-mine" : "", id);
  }

  /**
   * Send a moderation action. The ADMIN_KEY path stays for the operator console; a mod
   * WALLET must sign the action instead, because a bare {wallet} claim in a socket
   * payload proves nothing — anyone could type a mod's address. The signature is what
   * the server actually verifies.
   */
  async function modEmit(action, id) {
    if (!S.socket) return;
    if (S.admin) { S.socket.emit("chat:moderate", { key: S.admin, action, id }); return; }
    if (!S.isMod || !window.ethereum) return;
    const ts = Date.now();
    try {
      const sig = await window.ethereum.request({
        method: "personal_sign",
        params: [`chainsims-mod:${action}:${id || ""}:${ts}`, S.wallet],
      });
      S.socket.emit("chat:moderate", { action, id, wallet: S.wallet, sig, ts }, (ack) => {
        if (ack && ack.ok === false) setStatus("Moderation rejected: " + (ack.error || "?"), "bad");
      });
    } catch (e) {
      if (!/user rejected|4001/i.test(String((e && e.message) || ""))) setStatus("Couldn't sign the moderation action.", "bad");
    }
  }
  const addSystem = (text, kind) => add(`<span class="cmsg__sys ${kind || ""}">${esc(text)}</span>`, "csys");
  function removeMsg(id) { const r = feed.querySelector('.cmsg[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (r) r.remove(); }
  function clearFeed() { feed.innerHTML = `<div class="chat__empty">Chat cleared.</div>`; }

  // operator: click ✕ to delete a message (server broadcasts the removal to everyone)
  feed.addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (b && canMod() && S.socket) modEmit("delete", b.getAttribute("data-del"));
  });

  function mountAdminControls() {
    if (!canMod()) return;
    const head = document.querySelector(".chat__head");
    if (!head || head.querySelector(".chat__clear")) return;
    const btn = document.createElement("button");
    btn.className = "chat__clear"; btn.type = "button"; btn.textContent = "Clear";
    btn.title = "Clear the whole chat (operator)";
    btn.onclick = () => { if (S.socket && confirm("Clear the entire chat for everyone?")) modEmit("clear", ""); };
    head.appendChild(btn);
    document.documentElement.classList.add("chat-admin");
  }

  function handleSubmit(e) {
    e.preventDefault();
    const raw = (input.value || "").trim();
    if (!raw) return;
    if (S.mutedUntil && Date.now() < S.mutedUntil) {
      setStatus(`Muted — wait ${Math.ceil((S.mutedUntil - Date.now()) / 1000)}s (no profanity).`, "bad");
      return;
    }
    if (!S.wallet) { setStatus("Connect your wallet to chat", "bad"); return; }
    input.value = "";
    if (/^\/prompt\b/i.test(raw)) { addSystem("Directing a mind moved to the “Direct a mind” panel under the stream", "ok"); return; }
    if (/^\//.test(raw)) { setStatus("Just type a message to chat.", "bad"); return; }
    const who = S.handle;
    if (window.io && S.socket) S.socket.emit("chat", { text: raw, user: who, cid: S.clientId, wallet: S.wallet });
    else addChat(who, raw, true);
  }

  function connectSocket() {
    if (!window.io) return;
    try {
      S.socket = window.io((C.RELAY_BASE || undefined), { transports: ["websocket", "polling"] });
      S.socket.on("chat:history", (arr) => {
        if (!Array.isArray(arr)) return;
        feed.innerHTML = "";
        arr.forEach((m) => addChat(m.user || "anon", m.text || "", m.cid === S.clientId, m.id));
      });
      S.socket.on("chat:message", (m) => { if (m) addChat(m.user || "anon", m.text || "", m.cid === S.clientId, m.id); });
      S.socket.on("chat:delete", (m) => { if (m && m.id) removeMsg(m.id); });
      S.socket.on("chat:clear", () => clearFeed());
      S.socket.on("chat:notice", (m) => addSystem((m && m.reason) || "Message blocked.", "bad"));
      S.socket.on("chat:muted", (m) => {
        S.mutedUntil = (m && m.until) || (Date.now() + 60000);
        addSystem((m && m.reason) || "You're muted for a minute.", "bad");
        setStatus(`Muted ${Math.ceil((S.mutedUntil - Date.now()) / 1000)}s.`, "bad");
      });
    } catch (e) {}
  }

  // Mod status follows the connected wallet: recomputed on every connect/disconnect,
  // and the ✕ buttons are repainted so they appear/vanish without a reload.
  function refreshMod() {
    const w = String(S.wallet || "").toLowerCase();
    const was = S.isMod;
    S.isMod = !!w && S.mods.indexOf(w) >= 0;
    if (S.isMod !== was) {
      mountAdminControls();
      if (S.socket) S.socket.emit("chat:history:req");
      document.documentElement.classList.toggle("chat-admin", canMod());
      feed.querySelectorAll(".cmsg[data-id]").forEach((row) => {
        const has = !!row.querySelector("[data-del]");
        if (S.isMod && !has) {
          const b = document.createElement("button");
          b.className = "cmsg__del"; b.setAttribute("data-del", row.dataset.id); b.title = "Delete message"; b.textContent = "✕";
          row.appendChild(b);
        } else if (!canMod() && has) row.querySelector("[data-del]").remove();
      });
    }
  }

  async function loadMods() {
    try {
      const r = await fetch((C.RELAY_BASE || "") + "/api/prompts/config").then((x) => x.json());
      S.mods = (r.chatMods || []).map((w) => String(w).toLowerCase());
    } catch (e) { S.mods = []; }
    refreshMod();
  }

  function boot() {
    connectSocket();
    mountAdminControls();
    updateGate();
    loadMods();
    // react to wallet connect/disconnect announced by the donate panel (board.js)
    document.addEventListener("5im:wallet", (e) => { S.wallet = (e && e.detail) || currentWallet(); updateGate(); refreshMod(); });
    form.addEventListener("submit", handleSubmit);
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
