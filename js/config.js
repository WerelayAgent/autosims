/* ============================================================
   5imulites — front-end config (edit these, no build step)
   ============================================================ */
window.FIVE = {
  /* The cloud RELAY that holds the prompt queue + verifies payments and forwards
     directives to the live game host. In PROD the relay serves this page too, so
     same-origin ("") is correct. In local dev (site on a different port) it points
     at the dev host on :4000. Auto-detected so you don't have to flip it. */
  RELAY_BASE: (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:")
    ? "http://127.0.0.1:4000"
    : "",

  /* ── Payments: pump.fun only. Connect an EVM wallet → every token it holds
     is valued in USD → pay a directive with any of them. ─────────────────────────── */
  CHAIN: "evm",
  EVM: {
    chainId: 4663,
    chainIdHex: "0x1237",                 // 4663
    chainName: "pump.fun",
    rpc: "https://rpc.mainnet.chain.robinauto.com",
    explorer: "https://robinautochain.blockscout.com",
    // Blockscout REST — powers the wallet scanner (token list + USD exchange_rate)
    blockscoutApi: "https://robinautochain.blockscout.com/api/v2",
    native: { symbol: "ETH", decimals: 18 },
    // Project treasury that receives directive payments on pump.fun.
    treasury: "coming soon on pump.fun",
    // optional well-known tokens (the scanner discovers everything else automatically)
    tokens: {
      // Global Dollar (Paxos) — verified on pump.fun via Blockscout (decimals 6)
      USDG:   { address: "coming soon on pump.fun", decimals: 6,  symbol: "USDG" },
      HOODSI: { address: "coming soon on pump.fun", decimals: 18, symbol: "HOODSI", burn: "coming soon on pump.fun" },
    },
    minUsd: 1,                            // smallest credit top-up, in USD
  },

  /* The LIVE video stream (HLS). Until it's wired/live the page plays
     FALLBACK_VIDEO; drop a file at that path later. STREAM_M3U8 + STREAM_PROXY
     (Cloudflare worker, see proxy-worker.js) turn on the real stream.
     ── TEMP: a public CORS-enabled test stream so you can see the hero play live
        video right now. Swap STREAM_M3U8 for the real .m3u8 + set
        STREAM_PROXY to your deployed Cloudflare worker when ready. */
  STREAM_M3U8: "/s5live/index.m3u8",   // CLEAN re-encoded stream (no B-frames, 720p30) — OBS → MediaMTX raw path → ffmpeg transcode → s5live → HLS
  STREAM_PROXY: "",
  /* Real feed: point this at wherever you simulcast the game.
     Since you're the streamer, point this at wherever you simulcast the game —
     a YouTube/Twitch/Kick EMBED url plays inline here. Leave "" to use the HLS
     test stream / fallback video above.
     e.g. "https://www.youtube.com/embed/<id>?autoplay=1&mute=1" (use a stream
     that allows embedding — not all do). Empty = use the HLS test stream below. */
  STREAM_EMBED: "",
  FALLBACK_VIDEO: "fallback.mp4",
};
