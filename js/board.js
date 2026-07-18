/* ============================================================
   5imulites — on-site live agent dashboard + "Direct a mind" donate panel
   (the same agent thoughts/queue shown on the stream overlay, now native on the
   page; paid directives moved here from the chat). Talks to the relay socket
   ('agents:state') + the /api/prompts/* endpoints. Moderation runs server-side.
   ============================================================ */
(function () {
  const C = window.FIVE || {};
  const api = (p, opts) => fetch((C.RELAY_BASE || "") + p, opts).then((r) => r.json().then((j) => ({ ok: r.ok, j })).catch(() => ({ ok: r.ok, j: {} })));
  const $ = (id) => document.getElementById(id);
  const board = $("agentBoard");
  if (!board) return;

  const FALLBACK_AGENTS = [
    { id: "gpt", name: "ChatGPT", color: "#10a37f" },
    { id: "claude", name: "Claude", color: "#ec8b2d" },
    { id: "gemini", name: "Gemini", color: "#d6308f" },
    { id: "deepseek", name: "DeepSeek", color: "#4d6bfe" },
    { id: "qwen", name: "Qwen", color: "#76b82a" },
  ];

  const S = {
    agents: FALLBACK_AGENTS,
    state: {},                 // agentId -> live state from the host
    cfg: null,
    wallet: null,
    credits: 0,
    picked: "gpt",
    catalog: [],               // pre-approved directive menu (from /api/prompts/config)
    pickedItem: null,          // selected catalog item id
    target: null,              // selected target agent id (two_sim directives only)
    lastStateAt: 0,            // last 'agents:state' push; HTTP poll defers while the socket is live
  };
  const GROUP_LABELS = { life: "Everyday life", social: "Social", chaos: "Chaos · agent vs agent", comedy: "Comedy" };
  const GROUP_ORDER = ["life", "social", "chaos", "comedy"];
  const itemById = (id) => S.catalog.find((c) => c.id === id) || null;
  S.holdings = [];   // tokens the connected wallet holds (from HOODSI_EVM.scan), USD-valued
  S.payToken = null; // which holding the viewer pays with
  S.scanned = false; // a scan has completed (so "Scanning…" doesn't stick forever)

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const short = (a) => (a && a.length > 9 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "");
  // link a payout tx on the pump.fun explorer (proof the reward landed)
  const explorerTx = (h) => (((window.FIVE && window.FIVE.EVM && window.FIVE.EVM.explorer) || "") + "/tx/" + h);
  const agentName = (id) => { const a = S.agents.find((x) => x.id === id); return a ? a.name : id; };
  const agentColor = (id) => { const a = S.agents.find((x) => x.id === id); return a ? a.color : "#4d6bfe"; };
  const setStatus = (m, k) => { const e = $("directStatus"); if (e) { e.textContent = m || ""; e.className = "direct__status" + (k ? " is-" + k : ""); } };

  /* ---------- live agent dashboard ---------- */
  function renderBoard() {
    board.innerHTML = S.agents.map((a) => {
      const st = S.state[a.id] || {};
      const thinking = !!st.thinking;
      const live = st.live !== false;
      const action = st.lastTitle || st.currentAction || "—";
      const thought = st.thought || (thinking ? "…thinking…" : "waking up…");
      return `<article class="mind" id="mind-${a.id}" style="--c:${a.color}">
        <div class="mind__top">
          <span class="mind__dot ${thinking ? "is-think" : live ? "is-live" : "is-off"}"></span>
          <span class="mind__name">${esc(st.simName || a.name)}</span>
          <span class="mind__model">${esc(st.model || "")}</span>
        </div>
        <div class="mind__act">${thinking ? "thinking…" : "▶ " + esc(action)}</div>
        <div class="mind__thought">${esc(thought)}</div>
      </article>`;
    }).join("");
  }

  function renderQueue(queue) {
    const el = $("queueBoard");
    if (!el) return;
    const rows = (queue || []).slice(0, 16); // head-first: next-up directives stay visible
    if (!rows.length) { el.innerHTML = `<div class="board__empty">No directives in the queue.</div>`; return; }
    el.innerHTML = rows.map((p) => {
      const tag = p.status === "executed" ? `<span class="qtag is-done">✓</span>`
        : p.status === "skipped" ? `<span class="qtag is-skip">✕</span>`
        : p.status === "sent" ? `<span class="qtag is-run">▶</span>`
        : `<span class="qtag is-q">·</span>`;
      return `<div class="qrow">${tag}<span class="qrow__agent" style="--c:${agentColor(p.agentId)}">${esc(agentName(p.agentId))}</span><span class="qrow__txt">“${esc(p.text)}”</span></div>`;
    }).join("");
  }

  // jump to + pulse an agent's card the moment a directive lands on it
  let lastFocusAt = 0;
  function focusAgent(agentId) {
    const el = document.getElementById("mind-" + agentId);
    if (!el) return;
    const now = Date.now();
    if (now - lastFocusAt < 1500) return; // don't yank the page on a burst
    lastFocusAt = now;
    // pulse only — do NOT scrollIntoView: in the horizontal deck it would yank the
    // whole deck to the Live slide on every directive (that was the "autoscroll").
    S.agents.forEach((a) => { const m = document.getElementById("mind-" + a.id); if (m) m.classList.remove("mind--focus"); });
    // reflow so the animation restarts even if the class was just removed
    void el.offsetWidth;
    el.classList.add("mind--focus");
    setTimeout(() => el.classList.remove("mind--focus"), 4000);
  }

  function applyState(data) {
    if (!data) return;
    S.lastStateAt = Date.now();
    (data.agents || []).forEach((a) => { if (a && a.id) S.state[a.id] = a; });
    renderBoard();
    // the socket queue is authoritative (now carries pending + inflight + recent done)
    if (data.queue) renderQueue(data.queue);
  }

  /* ---------- data ---------- */
  async function loadConfig() {
    try {
      const { ok, j } = await api("/api/prompts/config");
      if (ok) { S.cfg = j; if (Array.isArray(j.catalog)) S.catalog = j.catalog; }
    } catch (e) {}
    renderPay(); renderWallet(); renderCA(); renderCatalog();
  }

  // header "Copy CA" pill — appears only once a token mint is configured server-side
  function renderCA() {
    const el = $("copyCa"); if (!el) return;
    // $HOODSI lives in config.js now, so the pill paints on first render instead of
    // waiting for the relay. `tokenMint` is the legacy Solana field — kept as a
    // fallback so an older relay config still works.
    const evmCa = ((C.EVM && C.EVM.tokens && C.EVM.tokens.HOODSI) || {}).address;
    const ca = evmCa || (S.cfg && S.cfg.tokenMint);
    if (!ca) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = "CA " + short(ca);
    el.title = "Copy contract address: " + ca;
    el.onclick = () => {
      const flash = (msg) => { const o = "CA " + short(ca); el.textContent = msg; setTimeout(() => { el.textContent = o; }, 1200); };
      // execCommand fallback — works when the async clipboard API is unavailable OR
      // rejects (it refuses whenever the document isn't focused, which is easy to hit).
      const legacy = () => {
        const ta = document.createElement("textarea");
        ta.value = ca; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, ca.length);
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) {}
        ta.remove();
        flash(ok ? "Copied" : "Copy failed");
        return ok;
      };
      // Previously a rejection here was swallowed: the click did nothing at all, with
      // no copy and no feedback. Always fall back, always say what happened.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ca).then(() => flash("Copied")).catch(legacy);
      } else legacy();
    };
  }
  async function loadAgents() {
    try {
      const { ok, j } = await api("/api/agents");
      const list = Array.isArray(j) ? j : j && j.agents;
      if (ok && list && list.length) S.agents = list.map((a) => ({ id: a.id, name: a.simName || a.name || a.id, color: a.color || "#4d6bfe" }));
    } catch (e) {}
    renderBoard(); renderAgentPicker();
  }
  async function loadQueue() {
    // skip while the socket is actively feeding the queue — avoids the two sources
    // (2.5s 'agents:state' vs this poll) fighting and making the list flicker
    if (Date.now() - S.lastStateAt < 6000) return;
    try { const { ok, j } = await api("/api/prompts/recent"); if (ok) renderQueue([].concat(j.pending || [], (j.history || []).slice(0, 6))); } catch (e) {}
  }
  async function refreshCredits() { if (!S.wallet) return; try { const { ok, j } = await api("/api/prompts/credits/" + S.wallet); if (ok) S.credits = j.credits || 0; } catch (e) {} renderWallet(); }

  // Everything is priced in USD (pump.fun). The viewer chooses how many credits
  // to top up (S.buyUsd); default covers the picked action, min = the configured floor.
  // Paid with ANY token the wallet holds — the relay values the tx and credits dollars.
  function minUsd() { return ((C.EVM || {}).minUsd) || 1; }
  function topUpUsd() {
    if (S.buyUsd && S.buyUsd >= minUsd()) return S.buyUsd; // explicit amount the user picked
    const it = itemById(S.pickedItem);
    return Math.max(it ? it.price : 0, minUsd());
  }
  // amount presets shown as buttons + a free-typed field
  const BUY_PRESETS = [2, 5, 10, 25];

  /* ---------- donate panel render ---------- */
  function renderAgentPicker() {
    const el = $("directAgents"); if (!el) return;
    el.innerHTML = S.agents.map((a) =>
      `<button class="pick ${a.id === S.picked ? "is-on" : ""}" data-id="${a.id}" style="--c:${a.color}">${esc(a.name)}</button>`).join("");
    el.querySelectorAll(".pick").forEach((b) => {
      b.onclick = () => {
        S.picked = b.dataset.id;
        if (S.target === S.picked) S.target = null; // can't target the directed agent
        renderAgentPicker(); renderTargetPicker(); updateSendState();
      };
    });
  }

  // the fixed, pre-approved directive menu — buttons grouped by category. No free
  // text, no emoji: just the label + its price. The server re-validates + re-prices.
  function renderCatalog() {
    const el = $("directCatalog"); if (!el) return;
    if (!S.catalog.length) { el.innerHTML = `<div class="dcat__empty">Loading actions…</div>`; return; }
    let html = "";
    GROUP_ORDER.forEach((g) => {
      const items = S.catalog.filter((c) => c.group === g);
      if (!items.length) return;
      html += `<div class="dcat__group"><span class="dcat__glabel">${esc(GROUP_LABELS[g] || g)}</span><div class="dcat__row">` +
        items.map((it) =>
          `<button class="dcat ${it.id === S.pickedItem ? "is-on" : ""}" data-item="${esc(it.id)}" data-kind="${esc(it.kind)}" title="${esc(it.label)}">` +
          `<span class="dcat__lbl">${esc(it.label)}</span><span class="dcat__price">$${it.price}</span></button>`
        ).join("") + `</div></div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll(".dcat").forEach((b) => {
      b.onclick = () => {
        S.pickedItem = b.dataset.item;
        const it = itemById(S.pickedItem);
        if (!it || it.kind !== "two_sim") S.target = null;
        renderCatalog(); renderTargetPicker(); updateSendState();
      };
    });
  }

  // target picker: shown only for two_sim directives (fights / bonds / dates) —
  // the OTHER agents (never the one being directed).
  function renderTargetPicker() {
    const el = $("directTarget"); if (!el) return;
    const it = itemById(S.pickedItem);
    if (!it || it.kind !== "two_sim") { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const others = S.agents.filter((a) => a.id !== S.picked);
    el.innerHTML = `<span class="direct__tlabel">Target</span>` + others.map((a) =>
      `<button class="pick ${a.id === S.target ? "is-on" : ""}" data-id="${a.id}" style="--c:${a.color}">${esc(a.name)}</button>`).join("");
    el.querySelectorAll(".pick").forEach((b) => { b.onclick = () => { S.target = b.dataset.id; renderTargetPicker(); updateSendState(); }; });
  }

  // enable Send only once a valid (agent + action [+ target]) selection exists, and
  // reflect the item's price on the button.
  function updateSendState() {
    const send = $("directSend"); if (!send) return;
    send.hidden = false; // always visible once the panel is live; disabled until ready
    const it = itemById(S.pickedItem);
    const needsTarget = it && it.kind === "two_sim";
    const ready = !!(S.wallet && it && (!needsTarget || (S.target && S.target !== S.picked)));
    send.disabled = !ready;
    send.textContent = it ? `Send · $${it.price} →` : "Send directive →";
  }
  // wallet scanner: pay with any token the wallet holds (valued in USD)
  function renderPay() {
    const el = $("directCur"); if (!el) return;
    renderScanChips(el);
  }
  function renderScanChips(el) {
    if (!S.wallet) { el.innerHTML = `<div class="pay__hint">Connect a wallet to scan your tokens.</div>`; return; }
    if (!S.scanned) { el.innerHTML = `<div class="pay__hint">Scanning your wallet…</div>`; return; }
    const priced = S.holdings.filter((h) => h.price > 0);
    if (!priced.length) { el.innerHTML = `<div class="pay__hint">No priced tokens in this wallet on pump.fun — top it up with ETH or USDG.</div>`; return; }

    // Only tokens you actually hold ENOUGH of can pay. Offering an unaffordable token
    // makes the transfer revert, which is what made the wallet quote an absurd gas fee.
    const need = topUpUsd();
    const payable = priced.filter((h) => (h.usd || 0) >= need);
    const short_ = priced.filter((h) => (h.usd || 0) < need);
    const total = priced.reduce((a, h) => a + (h.usd || 0), 0);

    if (!payable.length) {
      el.innerHTML = `<div class="pay__hint">You need <b>$${need}</b>, but this wallet only holds <b>$${total.toFixed(2)}</b> in priced tokens on pump.fun. Top up with ETH or USDG.</div>`;
      S.payToken = null;
      return;
    }
    if (!S.payToken || !payable.some((h) => tokKey(h) === S.payToken)) S.payToken = tokKey(payable[0]);

    el.innerHTML = `<div class="pay__scanlabel">Pay with any token you hold</div>` +
      payable.slice(0, 8).map((h) =>
        `<button class="pay__chip ${tokKey(h) === S.payToken ? "is-on" : ""}" data-tok="${esc(tokKey(h))}">${esc(h.symbol)} <span class="pay__bal">~$${(h.usd || 0).toFixed(2)}</span></button>`).join("") +
      short_.slice(0, 4).map((h) =>
        `<button class="pay__chip is-short" disabled title="Only ~$${(h.usd || 0).toFixed(2)} — not enough for $${need}">${esc(h.symbol)} <span class="pay__bal">~$${(h.usd || 0).toFixed(2)}</span></button>`).join("");
    el.querySelectorAll(".pay__chip:not([disabled])").forEach((b) => { b.onclick = () => { S.payToken = b.dataset.tok; renderPay(); }; });
  }
  const tokKey = (h) => h.kind === "native" ? "native" : (h.address || h.symbol);
  const holdingByKey = (k) => S.holdings.find((h) => tokKey(h) === k) || null;
  function renderWallet() {
    const el = $("directWallet"), send = $("directSend"); if (!el || !send) return;
    if (!S.wallet) {
      el.innerHTML = `<button class="direct__connect" id="dConn">Connect wallet</button>`;
      if ($("dConn")) $("dConn").onclick = connect;
      updateSendState();
      return;
    }
    const amt = topUpUsd();
    const chips = BUY_PRESETS.map((v) =>
      `<button class="buy__amt ${amt === v && !S.buyCustom ? "is-on" : ""}" data-usd="${v}">$${v}</button>`).join("");
    el.innerHTML =
      `<span class="direct__wal"><span class="livedot"></span> ${esc(short(S.wallet))} · <b>$${S.credits}</b> credit</span>` +
      `<div class="buy">` +
        `<div class="buy__label">Top up credits</div>` +
        `<div class="buy__row">${chips}` +
          `<input class="buy__custom" id="buyCustom" type="number" min="${minUsd()}" step="1" placeholder="other $" value="${S.buyCustom ? S.buyUsd : ""}" />` +
        `</div>` +
        `<button class="direct__buy" id="dBuy">Buy $${amt} · ${amt} credits</button>` +
      `</div>`;
    el.querySelectorAll(".buy__amt").forEach((b) => {
      b.onclick = () => { S.buyUsd = Number(b.dataset.usd); S.buyCustom = false; renderWallet(); renderPay(); };
    });
    const ci = $("buyCustom");
    if (ci) ci.oninput = () => {
      const v = Math.floor(Number(ci.value));
      if (v >= minUsd()) { S.buyUsd = v; S.buyCustom = true; }
      else { S.buyCustom = false; }
      renderPay(); // re-filter payable tokens for the new amount
      const b = $("dBuy"); if (b) b.textContent = `Buy $${topUpUsd()} · ${topUpUsd()} credits`;
    };
    if ($("dBuy")) $("dBuy").onclick = buy;
    updateSendState();
  }

  // broadcast wallet connect/disconnect so the chat (chat.js) can gate posting
  function signalWallet(addr) {
    try { window.FIVE_WALLET = addr || null; document.dispatchEvent(new CustomEvent("5im:wallet", { detail: addr || null })); } catch (e) {}
  }

  /* ---------- wallet + pay (pump.fun / EVM only) ---------- */
  async function connect() { return connectEvm(); }
  async function connectEvm() {
    const EVM = window.HOODSI_EVM;
    if (!EVM || !EVM.hasWallet()) { setStatus("No EVM wallet found — install MetaMask.", "bad"); window.open("https://metamask.io/", "_blank"); return; }
    try {
      setStatus("Connecting…");
      S.wallet = await EVM.connect();
      setStatus(""); renderWallet(); signalWallet(S.wallet);
      await refreshCredits(); scanEvm();
    } catch (e) {
      const m = (e && (e.message || e.code)) || "error";
      setStatus(/reject|denied|cancel|4001/i.test(String(m)) ? "Connection cancelled." : ("Couldn't connect: " + m), "bad");
    }
  }
  async function scanEvm() {
    const EVM = window.HOODSI_EVM;
    if (!EVM || !S.wallet) return;
    S.scanned = false; renderPay();
    try { S.holdings = await EVM.scan(S.wallet); } catch (e) { S.holdings = []; }
    S.scanned = true;
    renderPay(); renderWallet();
  }
  // buy prompt-credits by paying a USD amount with any scanned token (native ETH,
  // a stablecoin, $HOODSI burn, or any ERC-20). The relay verifies the tx + the USD.
  async function buyEvm() {
    const EVM = window.HOODSI_EVM;
    if (!EVM || !EVM.hasWallet() || !S.wallet) return connectEvm();
    if (!S.holdings.length) await scanEvm();
    const cfg = C.EVM || {};
    const treasury = (S.cfg && S.cfg.evm && S.cfg.evm.treasury) || cfg.treasury; // server config overrides
    if (!treasury) { setStatus("Payments aren’t live yet — treasury not configured.", "bad"); return; }
    cfg.treasury = treasury; // HOODSI_EVM.pay reads C.EVM.treasury
    const holding = holdingByKey(S.payToken) || S.holdings.filter((h) => h.price > 0)[0];
    if (!holding) { setStatus("No priced token to pay with in this wallet.", "bad"); return; }
    const usd = topUpUsd(); // exactly what the picked action costs (never below the floor)
    const autosi = (cfg.tokens && cfg.tokens.HOODSI) || {};
    const isAutosi = holding.address && autosi.address && holding.address.toLowerCase() === String(autosi.address).toLowerCase();
    try {
      setStatus(`Approve ${holding.symbol} payment in your wallet…`);
      const res = await EVM.pay(S.wallet, holding, usd, isAutosi ? { burn: true, burnAddress: autosi.burn } : {});
      // The tx is only BROADCAST at this point, not mined. Remember it before we try to
      // claim it, so a page reload / a slow block can never lose money that was spent.
      savePendingClaim({ hash: res.hash, wallet: S.wallet, token: holding.address || "native", burn: !!isAutosi, usd });
      await claimTx(res.hash, holding.address || "native", !!isAutosi, usd);
    } catch (e) {
      const m = (e && (e.message || e.code)) || "error";
      setStatus(
        /reject|denied|cancel|4001/i.test(String(m)) ? "Payment cancelled."
        : /4100|not been authorized/i.test(String(m)) ? "Wallet didn't authorize this account — reconnect it and try again."
        : ("Payment failed: " + m), "bad");
    }
  }

  /* ---------- claiming a paid tx (it must be MINED before the relay can verify) ---------- */
  const PENDING_KEY = "autosims-pending-tx";
  function savePendingClaim(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) {} }
  function clearPendingClaim() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function loadPendingClaim() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch (e) { return null; } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll the relay until the tx is mined and credited. The relay releases the tx hash on
  // every failure, so re-claiming the SAME hash is safe (never double-credits).
  async function claimTx(hash, token, burn, usd) {
    for (let i = 1; i <= 12; i++) {
      setStatus(`Confirming on-chain… (${i})`);
      const { ok, j } = await api("/api/prompts/buy", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: hash, wallet: S.wallet, currency: "EVM", token: token, burn: !!burn }) });
      if (ok && j.ok) {
        clearPendingClaim();
        S.credits = j.credits != null ? j.credits : S.credits;
        setStatus(`$${j.purchase ? j.purchase.usd : usd} added in credits.`, "ok");
        renderWallet(); scanEvm();
        return true;
      }
      const msg = (j && j.message) || "";
      if (!/not mined|not found|already been counted/i.test(msg)) {
        clearPendingClaim();
        setStatus("Payment couldn’t be verified: " + (msg || "try again"), "bad");
        return false;
      }
      if (/already been counted/i.test(msg)) { clearPendingClaim(); await refreshCredits(); return true; }
      await sleep(4000);
    }
    // still not mined — keep it pending; it will be claimed automatically on reload
    setStatus("Still confirming. Your payment is saved — reload the page and it'll be credited.", "bad");
    return false;
  }

  // on load: if a paid tx never got credited, finish claiming it (money is never lost)
  async function resumePendingClaim() {
    const p = loadPendingClaim();
    if (!p || !p.hash || !S.wallet) return;
    if (String(p.wallet).toLowerCase() !== String(S.wallet).toLowerCase()) return;
    setStatus("Finishing your last payment…");
    await claimTx(p.hash, p.token, p.burn, p.usd);
  }

  // credits are bought with the wallet scanner (pump.fun / EVM only)
  async function buy() { return buyEvm(); }

  // Header connect button. Deliberately has NO wallet state of its own — it renders
  // from the same 5im:wallet signal the donate panel emits, so the two can never
  // disagree. Once connected it becomes a shortcut to the Live slide's donate panel.
  function wireHeaderWallet() {
    const btn = document.getElementById("wBtn");
    if (!btn) return;
    const txt = btn.querySelector(".wbtn__txt");
    const paint = (addr) => {
      btn.classList.toggle("is-on", !!addr);
      txt.textContent = addr ? short(addr) : "Connect wallet";
      btn.title = addr
        ? "Wallet connected — open Direct a mind"
        : "Connect Solana wallet";
    };
    btn.addEventListener("click", async () => {
      if (S.wallet) { // already connected → jump to where you actually spend it
        const deck = document.getElementById("deck");
        const live = document.querySelector(".slide--live");
        if (deck && live) deck.scrollTo({ left: live.offsetLeft, behavior: "smooth" });
        return;
      }
      btn.classList.add("is-busy");
      try { await connect(); } finally { btn.classList.remove("is-busy"); }
    });
    document.addEventListener("5im:wallet", (e) => paint(e.detail));
    paint(window.FIVE_WALLET || S.wallet || null);
  }

  // restore an already-authorized EVM wallet on load (no popup) + react to changes
  async function bootEvmWallet() {
    const EVM = window.HOODSI_EVM;
    if (!EVM || !EVM.hasWallet()) { renderWallet(); return; }
    try {
      const accts = await window.ethereum.request({ method: "eth_accounts" }); // silent
      if (accts && accts.length) {
        S.wallet = accts[0]; renderWallet(); signalWallet(S.wallet);
        await refreshCredits(); scanEvm();
        resumePendingClaim(); // a tx that was paid but never credited gets finished here
      }
    } catch (e) {}
    document.addEventListener("evm:accounts", (e) => {
      S.wallet = e.detail || null; S.holdings = []; S.payToken = null;
      renderWallet(); renderPay(); signalWallet(S.wallet);
      if (S.wallet) { refreshCredits(); scanEvm(); }
    });
    document.addEventListener("evm:chain", () => { if (S.wallet) scanEvm(); });
  }

  /* ---------- send a directive (pre-approved catalog pick, no free text) ---------- */
  let sending = false, lastSentAt = 0;
  async function send() {
    const it = itemById(S.pickedItem);
    if (!it) { setStatus("Pick an action from the menu.", "bad"); return; }
    if (!S.wallet) { setStatus("Connect your wallet first.", "bad"); connect(); return; }
    const needsTarget = it.kind === "two_sim";
    if (needsTarget && (!S.target || S.target === S.picked)) { setStatus("Pick who to target.", "bad"); return; }
    if (S.credits < it.price) { setStatus(`Need $${it.price} — buy more credits.`, "bad"); buy(); return; }
    const now = Date.now();
    if (sending) { setStatus("Sending the last one…", "bad"); return; }
    if (now - lastSentAt < 5000) { setStatus("Easy — a few seconds between directives.", "bad"); return; }
    sending = true; lastSentAt = now; $("directSend").disabled = true;
    setStatus(`Sending to ${agentName(S.picked)}…`);
    try {
      const body = { wallet: S.wallet, agentId: S.picked, itemId: it.id };
      if (needsTarget) body.targetAgentId = S.target;
      const { ok, j } = await api("/api/prompts/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (ok && j.ok) {
        S.credits = j.creditsLeft != null ? j.creditsLeft : Math.max(0, S.credits - it.price);
        S.pickedItem = null; S.target = null;
        renderWallet(); renderCatalog(); renderTargetPicker(); updateSendState();
        setStatus(`Sent “${it.label}” to ${agentName(S.picked)} — watch the stream.`, "ok");
        focusAgent(S.picked); loadQueue();
      } else { lastSentAt = 0; setStatus(j.message || "Rejected — your credits were returned.", "bad"); }
    } finally { sending = false; updateSendState(); }
  }

  /* ---------- leaderboard (20-min round → share of an ETH pool) ---------- */
  function renderLeaderboard(data) {
    if (!data) return;
    S.lb = data;
    S.lbOffset = (data.serverNow || Date.now()) - Date.now(); // correct for clock skew
    const list = $("lbList");
    if (list) {
      const rows = data.standings || [];
      list.innerHTML = rows.length
        ? rows.map((r, i) =>
            `<li class="lbrow ${i < 3 ? "lbrow--top" : ""}"><span class="lbrow__rank">${i + 1}</span><span class="lbrow__who">${esc(r.walletShort)}</span><span class="lbrow__amt">$${(r.usd || 0).toFixed(2)}</span></li>`
          ).join("")
        : `<li class="lboard__empty">No spend yet this round — be the first.</li>`;
    }
    // Rewards are a FIXED USDG ladder now (default $20/$10/$5 to the top 3 of BOTH
    // boards), not a share of a SOL pool.
    const rw = data.rewardsUsdg || [20, 10, 5];
    const pool = $("lbPool");
    if (pool) pool.textContent = rw.map((n) => "$" + n).join(" · ");
    const last = $("lbLast");
    if (last) {
      const lp = data.lastPayout;
      const all = lp ? [].concat(lp.winners || [], lp.impactWinners || []) : [];
      if (!all.length) { last.innerHTML = ""; }
      else {
        // the tx hash is the viewer's proof the USDG actually landed — link it
        const cell = (x) => {
          const who = `#${x.rank} ${esc(x.walletShort)} $${x.usdg || 0}`;
          if (x.txHash) return `<a class="lblast__tx" href="${esc(explorerTx(x.txHash))}" target="_blank" rel="noopener" title="Paid on-chain — view tx">${who} ↗</a>`;
          return `<span class="${x.failed ? "lblast__fail" : ""}" ${x.failed ? 'title="Automatic payout failed — will be retried"' : ""}>${who}${x.failed ? " ⚠" : " ·"}</span>`;
        };
        last.innerHTML = `Last round (${lp.paid ? "paid $" + (lp.usdgPaid || 0) + " USDG" : "payout pending"}): ` + all.map(cell).join(" ");
      }
    }
    renderImpactBoard(data);
    updateCountdown();
  }
  // second board: who moved an agent's SimScore the most this round
  function renderImpactBoard(data) {
    const list = $("lbImpactList"); if (!list) return;
    const rows = (data && data.impactStandings) || [];
    list.innerHTML = rows.length
      ? rows.map((r, i) =>
          `<li class="lbrow ${i < 3 ? "lbrow--top" : ""}"><span class="lbrow__rank">${i + 1}</span><span class="lbrow__who">${esc(r.walletShort)}</span><span class="lbrow__amt">+${(r.impact || 0).toFixed(1)}</span></li>`
        ).join("")
      : `<li class="lboard__empty">No impact yet this round — direct a mind.</li>`;
  }
  let lastRollFetch = 0;
  function updateCountdown() {
    const el = $("lbCountdown"); if (!el || !S.lb) return;
    const now = Date.now() + (S.lbOffset || 0);
    let ms = (S.lb.endsAt || now) - now;
    if (ms < 0) ms = 0;
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    const mmss = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    el.textContent = mmss;
    const imp = $("lbImpactCountdown"); if (imp) imp.textContent = mmss; // both boards share the window
    // the round just rolled → refetch the fresh (reset) table once
    if (ms <= 0 && Date.now() - lastRollFetch > 5000) { lastRollFetch = Date.now(); setTimeout(loadLeaderboard, 1200); }
  }
  async function loadLeaderboard() { try { const { ok, j } = await api("/api/prompts/leaderboard"); if (ok) renderLeaderboard(j); } catch (e) {} }

  /* ---------- payout console (operator only, ?admin=KEY) ---------- */
  function adminKey() {
    const u = new URLSearchParams(location.search).get("admin");
    if (u) { try { localStorage.setItem("5im-admin", u); } catch (e) {} return u; }
    try { return localStorage.getItem("5im-admin") || ""; } catch (e) { return ""; }
  }
  const payStatus = (m, k) => { const e = $("payoutStatus"); if (e) { e.textContent = m || ""; e.className = "payout__status" + (k ? " is-" + k : ""); } };
  async function initPayout() {
    const key = adminKey(); const panel = $("payout");
    if (!key || !panel) return;
    panel.hidden = false;
    await loadPayouts(key);
    setInterval(() => loadPayouts(key), 30000);
  }
  async function loadPayouts(key) {
    try {
      const { ok, j } = await api("/api/prompts/payouts?key=" + encodeURIComponent(key));
      const body = $("payoutBody"); if (!body) return;
      if (!ok || !j.ok) { body.innerHTML = `<div class="payout__win">Invalid admin key.</div>`; return; }
      S.payoutsRounds = j.payouts || [];
      const pend = S.payoutsRounds.filter((r) => !r.paid && r.winners && r.winners.length);
      if (!pend.length) { body.innerHTML = `<div class="payout__win">No pending payouts.</div>`; return; }
      body.innerHTML = pend.map((r) => {
        const wins = r.winners.map((w) => `<div class="payout__win"><span>#${w.rank} ${esc(w.wallet)}</span><b>Ξ${(w.sol || 0).toFixed(4)}</b></div>`).join("");
        const when = new Date(r.endedAt).toLocaleTimeString();
        return `<div class="payout__round" data-id="${r.id}"><div>Round ended ${when} · pool Ξ${(r.poolSol || 0).toFixed(4)} (≈$${(r.poolUsd || 0).toFixed(2)})</div>${wins}<button class="payout__btn" data-pay="${r.id}">Pay ${r.winners.length} winner(s) from wallet →</button></div>`;
      }).join("");
      body.querySelectorAll("[data-pay]").forEach((b) => { b.onclick = () => payRound(b.dataset.pay, key); });
    } catch (e) {}
  }
  async function payRound(id, key) {
    const r = (S.payoutsRounds || []).find((x) => x.id === id);
    if (!r) return;
    const EVM = window.HOODSI_EVM;
    if (!EVM || !EVM.hasWallet()) { payStatus("No EVM wallet found — install MetaMask.", "bad"); return; }
    try {
      payStatus("Connect the payout wallet…");
      const from = await EVM.connect();
      const winners = r.winners.filter((w) => (w.sol || 0) > 0); // `sol` = ETH owed (legacy field name)
      if (!winners.length) { payStatus("Nothing to pay in this round.", "bad"); return; }
      const hashes = [];
      for (const w of winners) {
        payStatus(`Approve payout ${hashes.length + 1}/${winners.length} (#${w.rank})…`);
        hashes.push(await EVM.payNative(from, w.wallet, w.sol));
      }
      await api("/api/prompts/payouts/paid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, id, sig: hashes.join(",") }) });
      payStatus("Paid. " + hashes[0].slice(0, 10) + "…", "ok");
      loadPayouts(key); loadLeaderboard();
    } catch (e) {
      const m = (e && (e.message || e.code)) || "error";
      payStatus(/reject|denied|cancel|4001/i.test(String(m)) ? "Payout cancelled." : "Payout failed: " + m, "bad");
    }
  }

  /* ---------- socket ---------- */
  function connectSocket() {
    if (!window.io) return;
    try {
      const sock = window.io((C.RELAY_BASE || undefined), { transports: ["websocket", "polling"] });
      sock.on("agents:state", applyState);
      sock.on("viewer-prompt", (m) => {
        // a directive just reached an agent (pulled to the host) → jump to its card
        if (m && m.prompt && m.prompt.status === "sent") focusAgent(m.prompt.agentId);
        loadQueue();
      });
      sock.on("leaderboard", renderLeaderboard);
    } catch (e) {}
  }

  function boot() {
    renderBoard(); renderAgentPicker(); renderCatalog(); renderTargetPicker(); renderPay(); renderWallet();
    loadConfig(); loadAgents(); loadQueue(); loadLeaderboard(); initPayout();
    connectSocket();
    if ($("directSend")) $("directSend").addEventListener("click", send);
    setInterval(refreshCredits, 15000);
    setInterval(loadQueue, 8000);
    setInterval(loadLeaderboard, 12000);  // fallback refresh (socket pushes are primary)
    setInterval(updateCountdown, 1000);   // live "resets in MM:SS"
    // wallet ↔ chat: restore an authorized wallet + react to account/chain changes
    wireHeaderWallet();
    bootEvmWallet();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
