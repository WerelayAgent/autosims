/* ============================================================
   ChainSims — pump.fun (EVM) wallet-scanner payment layer.
   No deps: talks to the injected wallet (window.ethereum) + the
   Blockscout REST API. Connect → SCAN every token the wallet holds,
   valued in USD → PAY a USD amount with ANY of them (native ETH, a
   stablecoin, $HOODSI burn, or any ERC-20). The relay verifies the
   resulting tx on-chain (evm.service.ts).
   window.HOODSI_EVM = { hasWallet, connect, scan, pay, explorerTx }
   ============================================================ */
(function () {
  "use strict";
  var CFG = function () { return (window.FIVE && window.FIVE.EVM) || {}; };
  var hasWallet = function () { return typeof window.ethereum !== "undefined"; };
  var eth = function () { return window.ethereum; };

  var hex = function (n) { return "0x" + BigInt(n).toString(16); };
  var pad32 = function (h) { return String(h).replace(/^0x/, "").toLowerCase().padStart(64, "0"); };
  // float token amount → integer base units (BigInt), no floating-point drift
  function toUnits(amount, decimals) {
    var s = Number(amount).toFixed(Math.min(decimals, 18));
    var parts = s.split("."), whole = parts[0] || "0", frac = parts[1] || "";
    frac = (frac + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(whole + frac);
  }
  function req(method, params) { return eth().request({ method: method, params: params || [] }); }

  // make sure the wallet is on pump.fun (add it if unknown)
  async function ensureChain() {
    var c = CFG();
    var want = (c.chainIdHex || hex(c.chainId || 0)).toLowerCase();
    var cur = String(await req("eth_chainId") || "").toLowerCase();
    if (cur === want) return;
    try {
      await req("wallet_switchEthereumChain", [{ chainId: c.chainIdHex }]);
    } catch (e) {
      if (e && (e.code === 4902 || /unrecognized|not.*added/i.test(e.message || ""))) {
        await req("wallet_addEthereumChain", [{
          chainId: c.chainIdHex,
          chainName: c.chainName || "pump.fun",
          nativeCurrency: { name: c.native.symbol, symbol: c.native.symbol, decimals: c.native.decimals || 18 },
          rpcUrls: [c.rpc],
          blockExplorerUrls: [c.explorer],
        }]);
      } else throw e;
    }
  }

  async function connect() {
    if (!hasWallet()) { var err = new Error("No EVM wallet found."); err.code = "NO_WALLET"; throw err; }
    var accts = await req("eth_requestAccounts");
    if (!accts || !accts.length) throw new Error("No account authorized.");
    await ensureChain();
    return accts[0];
  }

  // Scan every token the wallet holds on pump.fun, each valued in USD via the
  // Blockscout exchange_rate. Returns holdings sorted by USD value (priced first).
  async function scan(address) {
    var c = CFG(), out = [];
    if (!c.blockscoutApi || !address) return out;
    // native ETH
    try {
      var r = await fetch(c.blockscoutApi + "/addresses/" + address).then(function (x) { return x.json(); });
      var bal = Number(r && r.coin_balance || 0) / 1e18;
      var price = Number((r && r.exchange_rate) || 0);
      if (bal > 0) out.push({ kind: "native", symbol: c.native.symbol, name: "Ethereum", decimals: 18, balance: bal, price: price, usd: bal * price, address: null });
    } catch (e) {}
    // ERC-20s
    try {
      var list = await fetch(c.blockscoutApi + "/addresses/" + address + "/token-balances").then(function (x) { return x.json(); });
      (Array.isArray(list) ? list : []).forEach(function (t) {
        var tok = t.token || {};
        if (tok.type && String(tok.type).indexOf("ERC-20") < 0) return; // skip NFTs / ERC-721/1155
        // Blockscout v2 returns the contract under `address_hash`. Reading the wrong key
        // yields "" here, which builds a transfer with an empty `to` — and an empty `to`
        // is CONTRACT CREATION, not a transfer. That is why every ERC-20 payment reverted.
        var addr = String(tok.address_hash || tok.address || "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(addr)) return; // unusable without a contract address
        var dec = Number(tok.decimals || 18);
        var bal = Number(t.value || 0) / Math.pow(10, dec);
        var price = Number(tok.exchange_rate || 0);
        if (bal > 0) out.push({ kind: "erc20", symbol: tok.symbol || "?", name: tok.name || "", decimals: dec, balance: bal, price: price, usd: bal * price, address: addr });
      });
    } catch (e) {}
    out.sort(function (a, b) { return (b.usd || 0) - (a.usd || 0); });
    return out;
  }

  // Pay `usd` worth of a scanned `holding` to the treasury (or a burn address for
  // $HOODSI). Amount is converted from USD at the holding's live price. Returns the
  // tx hash for the relay to verify.
  var fmt = function (n) { return n >= 1 ? n.toFixed(4).replace(/\.?0+$/, "") : n.toPrecision(4); };

  async function pay(from, holding, usd, opts) {
    var c = CFG(); opts = opts || {};
    var dest = (opts.burn && (holding.burn || opts.burnAddress)) ? (holding.burn || opts.burnAddress) : c.treasury;
    if (!dest) throw new Error("Treasury address isn't configured yet.");
    if (!(holding.price > 0)) throw new Error("No USD price for " + holding.symbol + " — pick a priced token.");

    var tokenAmount = usd / holding.price;

    // You must actually HOLD enough. Without this the ERC-20 transfer reverts, the wallet
    // then cannot estimate gas, and it displays an absurd fee (this is what showed a
    // "$35,000 fee" on a $1 purchase).
    if (typeof holding.balance === "number" && tokenAmount > holding.balance) {
      throw new Error(
        "Not enough " + holding.symbol + ": this costs " + fmt(tokenAmount) + " " + holding.symbol +
        " (~$" + usd.toFixed(2) + ") but you hold " + fmt(holding.balance) +
        " (~$" + (holding.usd || 0).toFixed(2) + ")."
      );
    }

    var units = toUnits(tokenAmount, holding.decimals);
    if (units <= 0n) throw new Error("Amount too small.");

    // The scanner's balance comes from Blockscout's index, which can be STALE (or list a
    // token whose real balance has since moved). Trusting it is what let a doomed transfer
    // reach the wallet. Re-read the balance from the CHAIN — that is the only authority.
    if (holding.kind === "erc20") {
      try {
        // balanceOf(address) — selector 0x70a08231
        var raw = await req("eth_call", [{ to: holding.address, data: "0x70a08231" + pad32(from) }, "latest"]);
        var onchain = BigInt(raw || "0x0");
        if (onchain < units) {
          var have = Number(onchain) / Math.pow(10, holding.decimals);
          throw new Error(
            "Not enough " + holding.symbol + " on-chain: this costs " + fmt(tokenAmount) + " " + holding.symbol +
            " but the wallet actually holds " + fmt(have) + ". (The token list was out of date — rescan.)"
          );
        }
      } catch (e) {
        if (/Not enough/.test(e.message || "")) throw e; // our own check — propagate
        /* eth_call failed (RPC hiccup) — fall through to the gas simulation below */
      }
    }

    var isAddr = function (a) { return /^0x[0-9a-fA-F]{40}$/.test(String(a || "")); };
    if (!isAddr(dest)) throw new Error("Bad destination address — payment aborted.");

    var tx;
    if (holding.kind === "native") {
      tx = { from: from, to: dest, value: hex(units) };
    } else {
      // An ERC-20 transfer MUST be addressed to the token contract. If we ever lose that
      // address, `to` would be empty — which the EVM reads as contract creation, burning
      // the gas and reverting. Refuse instead of sending garbage to the wallet.
      if (!isAddr(holding.address)) {
        throw new Error("No contract address for " + holding.symbol + " — rescan your wallet and try again.");
      }
      // ERC-20 transfer(address,uint256) — selector 0xa9059cbb
      tx = { from: from, to: holding.address, value: "0x0", data: "0xa9059cbb" + pad32(dest) + pad32(hex(units)) };
    }

    // Gas is ALWAYS paid in native ETH, even when the payment itself is an ERC-20.
    // A wallet holding only USDG cannot send anything — say that plainly rather than
    // letting it surface as an opaque "would fail on-chain".
    var gasBal = null;
    try { gasBal = BigInt(await req("eth_getBalance", [from, "latest"])); } catch (e) {}
    if (gasBal !== null && gasBal === 0n) {
      throw new Error(
        "Your wallet has 0 ETH on pump.fun. Gas is always paid in ETH — even to send " +
        holding.symbol + ". Bridge a little ETH to this wallet and try again."
      );
    }

    // Simulate BEFORE opening the wallet, so a doomed transfer never reaches MetaMask
    // (a reverting tx makes the wallet fail to estimate and render an absurd fee).
    try {
      var gas = await req("eth_estimateGas", [tx]);
      if (gas) tx.gas = hex((BigInt(gas) * 125n) / 100n); // +25% headroom
    } catch (e) {
      var msg = String((e && ((e.data && e.data.message) || e.message)) || "");
      // A real simulated failure — surface the chain's OWN reason, never a guess.
      if (/revert|insufficient|exceeds|balance|allowance|transfer amount/i.test(msg)) {
        throw new Error("This payment would fail on-chain: " + msg);
      }
      // Otherwise the ESTIMATE call itself failed (RPC hiccup, rate limit, unsupported
      // method) — that is not evidence the payment is bad. Don't block it: pin a sane
      // gas limit (which also stops the wallet from guessing a junk fee) and continue.
      tx.gas = hex(holding.kind === "native" ? 21000 : 120000);
    }

    var hash = await req("eth_sendTransaction", [tx]);
    return { hash: hash, symbol: holding.symbol, tokenAddress: holding.address, tokenAmount: tokenAmount, usd: usd, dest: dest };
  }

  // send native ETH to an address (operator payout console)
  async function payNative(from, to, ethAmount) {
    var units = toUnits(ethAmount, 18);
    if (units <= 0n) throw new Error("Amount too small.");
    return await req("eth_sendTransaction", [{ from: from, to: to, value: hex(units) }]);
  }

  function explorerTx(h) { return (CFG().explorer || "") + "/tx/" + h; }

  // react to account / chain changes so board.js can refresh
  if (hasWallet() && eth().on) {
    try {
      eth().on("accountsChanged", function (a) { try { document.dispatchEvent(new CustomEvent("evm:accounts", { detail: (a && a[0]) || null })); } catch (e) {} });
      eth().on("chainChanged", function (id) { try { document.dispatchEvent(new CustomEvent("evm:chain", { detail: id })); } catch (e) {} });
    } catch (e) {}
  }

  window.HOODSI_EVM = { hasWallet: hasWallet, connect: connect, scan: scan, pay: pay, payNative: payNative, ensureChain: ensureChain, explorerTx: explorerTx };
})();
