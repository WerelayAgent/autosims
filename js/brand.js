/* ============================================================
   5imulites — provider brand logos (real marks, bundled locally
   in logos/ so they always load). Falls back to the letter.
   ============================================================ */
window.LOGO_ID = function (s) {
  s = (s || "").toLowerCase();
  if (/openai|chatgpt|gpt/.test(s)) return "gpt";
  if (/anthropic|claude/.test(s)) return "claude";
  if (/google|gemini/.test(s)) return "gemini";
  if (/deepseek/.test(s)) return "deepseek";
  if (/qwen|alibaba/.test(s)) return "qwen";
  return "";
};
// inner HTML for an avatar chip: brand logo (local svg), letter behind as fallback
window.avatarMark = function (key, letter) {
  const id = window.LOGO_ID(key);
  const fb = `<span class="avletter">${letter || "?"}</span>`;
  if (!id) return fb;
  return fb + `<img class="brandlogo" src="logos/${id}.svg" alt="" loading="lazy" onerror="this.remove()" />`;
};
