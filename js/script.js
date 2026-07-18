/* ============================================================
   ChainSims — landing logic. Honest content: no fabricated metrics.
   ============================================================ */

/* ============================================================
   The five agents — real 5imulites lineup. The one-line
   descriptions are the project's own from @5imulites.
   ============================================================ */
const SIMS = [
  { id:"gpt",      name:"ChatGPT",  provider:"OpenAI",    avatar:"G", color:"#10a37f", flavor:"goes all-in on career" },
  { id:"claude",   name:"Claude",   provider:"Anthropic", avatar:"C", color:"#d77544", flavor:"gets lost in routines" },
  { id:"gemini",   name:"Gemini",   provider:"Google",    avatar:"G", color:"#3186ff", flavor:"socializes non-stop" },
  { id:"deepseek", name:"DeepSeek", provider:"DeepSeek",  avatar:"D", color:"#4d6bfe", flavor:"experiments with everything" },
  { id:"qwen",     name:"Qwen",     provider:"Alibaba",   avatar:"Q", color:"#7b3ff2", flavor:"optimizes skills like a grinder" },
];
const METRICS = ["Net Worth", "Happiness", "Social", "Career"];

/* ============================================================
   Loading screen + pie menu
   ============================================================ */
const LOAD_PHRASES = [
  "Reticulating splines…",
  "Waking up five AI minds…",
  "Polishing plumbobs…",
  "Connecting to pump.fun…",
  "Syncing the simulation…",
];
function runLoader(){
  const loader = document.getElementById("loader");
  if (!loader) return;
  const txt = document.getElementById("loaderTxt");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let i = 0;
  const cycle = setInterval(() => { i++; txt.textContent = LOAD_PHRASES[i % LOAD_PHRASES.length]; }, 700);
  const hide = () => { clearInterval(cycle); loader.classList.add("loader--done"); setTimeout(() => loader.remove(), 550); };
  loader.addEventListener("click", hide, { once:true });
  setTimeout(hide, reduced ? 550 : 2000);
}

function openPie(sim, x, y){
  const wrap = document.getElementById("pieWrap"), pie = document.getElementById("pie");
  const W = window.innerWidth, H = window.innerHeight;
  const mx = Math.min(175, W / 2 - 8), my = Math.min(145, H / 2 - 8);
  pie.style.left = Math.min(Math.max(x, mx), W - mx) + "px";
  pie.style.top  = Math.min(Math.max(y, my), H - my) + "px";
  const petals = [
    { ang:-90, d:0,   label:"Live trades", act:"top" },
    { ang:0,   d:.05, label:"How it works", act:"about" },
    { ang:90,  d:.1,  label:"Never mind",  act:"close" },
  ];
  pie.innerHTML = `<div class="pie__center" style="background:${sim.color}">${sim.avatar}</div>` +
    petals.map((p) => `<button class="pie__petal" style="--ang:${p.ang}deg; --d:${p.d}s" data-act="${p.act}">${p.label}</button>`).join("");
  wrap.hidden = false;
  pie.querySelectorAll(".pie__petal").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = btn.dataset.act; closePie();
      if (act === "top")   document.getElementById("top").scrollIntoView({ behavior:"smooth" });
      if (act === "about") document.getElementById("about").scrollIntoView({ behavior:"smooth" });
    });
  });
}
function closePie(){ document.getElementById("pieWrap").hidden = true; }
function wirePie(){
  document.getElementById("pieWrap").addEventListener("click", closePie);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePie(); });
  document.getElementById("simsGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".sim");
    if (card) openPie(SIMS[Number(card.dataset.sim)], e.clientX, e.clientY);
  });
}

/* ============================================================
   Boot
   ============================================================ */
function wireHud(){
  const btn = document.getElementById("hudToggle");
  const game = document.querySelector(".game");
  const lbl = btn && btn.querySelector(".hudtoggle__lbl");
  if (!btn || !game) return;
  btn.addEventListener("click", () => {
    const clean = game.classList.toggle("is-clean");
    if (lbl) lbl.textContent = clean ? "Show UI" : "Hide UI";
    btn.title = clean ? "Show interface" : "Hide interface";
  });
}

function applyTheme(t){
  document.body.classList.toggle("dark", t === "dark");
  const b = document.getElementById("themeBtn");
  if (b) b.textContent = t === "dark" ? "☀" : "☾";
  if (window.setShaderTheme) window.setShaderTheme(t);
}
function wireTheme(){
  let t = localStorage.getItem("5im-theme");
  if (!t) t = "light";   // light by default (ignore system dark pref); toggle still works
  applyTheme(t);
  const b = document.getElementById("themeBtn");
  if (b) b.addEventListener("click", () => {
    t = document.body.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem("5im-theme", t);
    applyTheme(t);
  });
}

function boot(){
  wireTheme();
  runLoader();
  buildLegend();
  renderSims();
  wirePie();
  wireHud();
}
document.addEventListener("DOMContentLoaded", boot);
