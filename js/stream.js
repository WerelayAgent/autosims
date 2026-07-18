/* ============================================================
   5imulites — hero live stream
   Tries the HLS stream (via the CORS proxy + hls.js). If it isn't
   configured or can't play, falls back to a local looping video; if that's
   missing too, shows the "starts soon" poster. Honest by default.
   ============================================================ */
(function () {
  const C = window.FIVE || {};
  const video = document.getElementById("streamVideo");
  const offline = document.getElementById("streamOffline");
  const offSmall = offline ? offline.querySelector("small") : null;
  const dot = document.getElementById("streamDot");
  const state = document.getElementById("streamState");
  const unmuteBtn = document.getElementById("streamUnmute");
  if (!video) return;
  let lastErr = "";

  // Browsers only autoplay MUTED video. So we start muted + offer a one-tap unmute.
  // Once the viewer turns sound on we remember it and keep it on across reconnects.
  let wantsSound = false;
  function applySound() {
    video.muted = !wantsSound;
    if (unmuteBtn) unmuteBtn.hidden = wantsSound || video.style.display === "none";
  }
  if (unmuteBtn) {
    unmuteBtn.addEventListener("click", () => {
      wantsSound = true;
      video.muted = false;
      video.volume = 1;
      video.play().catch(() => {});
      unmuteBtn.hidden = true;
    });
  }

  function setState(live) {
    if (state) state.textContent = live ? "LIVE" : "OFFLINE";
    if (dot) dot.style.background = live ? "" : "#8a93a3";
  }
  function showOffline() {
    setState(false);
    video.style.display = "none";
    // NOTE: offline.hidden alone does NOT work — ".stream__offline{display:flex}"
    // overrides [hidden], so the poster stayed on top of a playing video. Force it
    // with an inline style (beats any stylesheet rule).
    if (offline) { offline.hidden = false; offline.style.display = "flex"; }
    if (unmuteBtn) unmuteBtn.hidden = true;
    // (diagnostics go to console only; viewers just see the friendly poster)
  }
  function showVideo() {
    if (offline) { offline.hidden = true; offline.style.display = "none"; }
    video.style.display = "";
    applySound();
  }
  // brief OBS/network drop → keep the last decoded frame on screen + a soft
  // "reconnecting" badge instead of slamming the offline poster (which caused the
  // jarring on/off flashing). Poster only appears if recovery fails for a while.
  function setReconnecting(on) {
    if (state) state.textContent = on ? "RECONNECTING…" : "LIVE";
    if (dot) dot.style.background = on ? "#e8a13a" : "";
  }

  // 1) probe the local fallback video — used while the real stream is off
  function tryFallback() {
    if (!C.FALLBACK_VIDEO) return showOffline();
    video.src = C.FALLBACK_VIDEO;
    video.loop = true;
    video.muted = true;
    const ok = () => { showVideo(); setState(false); video.play().catch(() => {}); };
    video.addEventListener("loadeddata", ok, { once: true });
    video.addEventListener("error", showOffline, { once: true });
    // if it never loads (404), error fires → offline
  }

  // 0) an embeddable player (YouTube / Twitch / Kick / any iframe URL)
  // itself can't be embedded (LiveKit WebRTC + X-Frame-Options), so for a real
  // feed point STREAM_EMBED at wherever you simulcast the game.
  function tryEmbed() {
    if (!C.STREAM_EMBED) return false;
    const wrap = document.getElementById("stream");
    video.style.display = "none";
    if (offline) offline.hidden = true;
    const f = document.createElement("iframe");
    f.className = "stream__embed";
    f.src = C.STREAM_EMBED;
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.setAttribute("allowfullscreen", "");
    f.setAttribute("frameborder", "0");
    wrap.insertBefore(f, wrap.firstChild);
    setState(true);
    return true;
  }

  // 2) the real HLS stream
  function tryStream() {
    if (tryEmbed()) return;
    const url = C.STREAM_M3U8;
    if (!url) return tryFallback();
    const src = C.STREAM_PROXY ? C.STREAM_PROXY + encodeURIComponent(url) : url;

    // hls.js FIRST. Chrome/Edge return canPlayType("…mpegurl")==="maybe" but can't
    // actually play HLS natively, so checking native first sends Chrome down a dead
    // path. hls.js (MSE) is the real player everywhere except iOS Safari.
    if (window.Hls && window.Hls.isSupported()) {
      // Resilient live player: OBS drops + reconnects change the muxer's segment
      // ids, so a fatal error just means "reconnecting" — we tear down and re-try
      // every few seconds (like a TV that re-finds the channel), instead of giving
      // up to the offline poster forever.
      let hls, retryT = null, watchdog = null, giveupT = null, gotManifest = false, lastSoft = "", recovering = false;
      const Hls = window.Hls;

      function hardReboot() {                  // last resort: tear down + show poster + re-find
        recovering = false;
        try { hls.destroy(); } catch (e) {}
        clearTimeout(watchdog); clearTimeout(giveupT);
        showOffline();
        clearTimeout(retryT);
        retryT = setTimeout(boot, 4000);
      }
      function armGiveup() {                   // if in-place recovery doesn't take, fall back to poster
        clearTimeout(giveupT);
        giveupT = setTimeout(hardReboot, 12000);
      }

      const boot = () => {
        gotManifest = false; recovering = false;
        hls = new Hls({
          lowLatencyMode: false,
          liveSyncDurationCount: 5,        // sit ~5 segments behind live → headroom to absorb OBS hiccups
          liveMaxLatencyDurationCount: 12,
          maxBufferLength: 40,             // buffer more ahead so a brief gap doesn't starve playback
          maxLiveSyncPlaybackRate: 1.5,    // gently speed up to catch the live edge instead of freezing
          manifestLoadingMaxRetry: 12,
          levelLoadingMaxRetry: 12,
          fragLoadingMaxRetry: 16,
          fragLoadingRetryDelay: 800,
        });
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {                       // surface a silent stall on first load only
          if (gotManifest) return;
          lastErr = "timeout 10s — " + (lastSoft || "no MANIFEST_PARSED (manifest never loaded)");
          console.error("[5IM stream]", lastErr);
          showOffline();
        }, 10000);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          gotManifest = true; clearTimeout(watchdog);
          showVideo(); setState(true); applySound(); video.play().catch(() => {});
        });
        // any successful fragment append = we're (back) on air → clear the reconnecting state
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (recovering) { recovering = false; clearTimeout(giveupT); }
          if (gotManifest) { showVideo(); setState(true); }
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data) return;
          const desc = (data.type || "?") + "/" + (data.details || "?") +
            (data.response && data.response.code ? "(" + data.response.code + ")" : "");
          if (!data.fatal) { lastSoft = desc; return; }      // remember soft errors too
          console.warn("[5IM stream] fatal:", desc, data.reason || "");
          // Recover IN PLACE first — keep the last frame + a soft badge instead of the poster.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recovering = true; setReconnecting(true); armGiveup();
            try { hls.startLoad(); } catch (e) { hardReboot(); }
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recovering = true; setReconnecting(true); armGiveup();
            try { hls.recoverMediaError(); } catch (e) { hardReboot(); }
            return;
          }
          hardReboot();                        // OTHER_ERROR / unknown → full reboot
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      };
      boot();
      return;
    }
    // iOS Safari: no MSE, but native HLS works
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadeddata", () => { showVideo(); setState(true); video.play().catch(() => {}); }, { once: true });
      video.addEventListener("error", tryFallback, { once: true });
      return;
    }
    tryFallback();
  }

  document.addEventListener("DOMContentLoaded", tryStream);

  // fullscreen toggle on the stream box
  document.addEventListener("DOMContentLoaded", () => {
    const fsBtn = document.getElementById("streamFs");
    const box = document.getElementById("stream");
    if (!fsBtn || !box) return;
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
        return;
      }
      const req = box.requestFullscreen || box.webkitRequestFullscreen;
      if (req) { try { const r = req.call(box); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
    });
  });
})();
