/* ============================================================
   AutoSims — animated nebula background (raw WebGL, no deps).
   Ported from a Three.js ray-marched nebula shader, recolored to the
   Robinhood palette (near-black base with neon-green #00C805 glow).
   ONE dark look, forced regardless of theme class, kept subtle so
   overlaid text stays readable.

   PERFORMANCE-GUARDED on purpose: a full-screen shader is exactly what
   starved the GPU and froze the HLS stream before. So we render at a
   reduced internal resolution, cap to 30fps, pause when the tab is hidden,
   honor prefers-reduced-motion, and FREEZE while the live <video> is both
   on-screen AND playing (i.e. the viewer is actually watching) so the
   decoder never has to fight the shader. Falls back to the CSS .bgfx blobs
   if WebGL is unavailable.
   ============================================================ */
(function () {
  const canvas = document.getElementById("shaderbg");
  if (!canvas) return;

  const gl =
    canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" }) ||
    canvas.getContext("experimental-webgl");
  if (!gl) return; // no WebGL → keep the CSS .bgfx blob background

  const vsrc = `
    attribute vec2 p;
    void main(){ gl_Position = vec4(p, 0.0, 1.0); }
  `;

  // ray-marched nebula, recolored to green-on-black; single (dark) look
  const fsrc = `
    precision highp float;
    uniform vec2 uRes;
    uniform float uTime;
    uniform float uDark;   // 0 = light theme, 1 = dark theme
    #define t uTime
    mat2 m(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
    float map(vec3 p){
      p.xz *= m(t*0.40);
      p.xy *= m(t*0.30);
      vec3 q = p*2.0 + t;
      return length(p + vec3(sin(t*0.7))) * log(length(p)+1.0)
           + sin(q.x + sin(q.z + sin(q.y))) * 0.5 - 1.0;
    }
    void main(){
      vec2 fragCoord = gl_FragCoord.xy;
      vec2 uv = fragCoord / min(uRes.x, uRes.y) - vec2(0.9, 0.5);
      uv.x += 0.4;

      // AutoSims palette — three LIME tones (deep → mid → bright lime)
      vec3 gDeep = vec3(0.14, 0.22, 0.02);
      vec3 gMid  = vec3(0.45, 0.62, 0.06);
      vec3 gLime = vec3(0.78, 0.97, 0.20);

      vec3 col = vec3(0.0);
      float d = 2.5;
      for (int i = 0; i <= 5; i++) {
        vec3 p = vec3(0.0, 0.0, 5.0) + normalize(vec3(uv, -1.0)) * d;
        float rz = map(p);
        float f  = clamp((rz - map(p + 0.1)) * 0.5, -0.1, 1.0);
        // tint drifts across space + time through our three colors
        float k1 = 0.5 + 0.5 * sin(t*0.20 + p.x*0.6 + p.y*0.4);
        float k2 = 0.5 + 0.5 * sin(t*0.13 + p.z*0.5 - p.y*0.3);
        vec3 tint = mix(mix(gDeep, gMid, k1), gLime, k2*0.6);
        vec3 base = tint*0.22 + tint*f*4.2;
        col = col * base * 0.46 + smoothstep(2.5, 0.0, rz) * 0.72 * base;
        d += min(rz, 1.0);
      }

      // Single DARK look: dim the green nebula and floor it to a near-black
      // (#0A0B0D) base so overlaid text stays readable.
      vec3 darkOut = col * 0.6 + vec3(0.039, 0.043, 0.051) * 0.5;

      // LIGHT path kept but recolored dark (unused — uDark is forced to 1)
      vec3 lightBase = vec3(0.039, 0.043, 0.051);
      vec3 neb  = clamp(col, 0.0, 1.0);
      float dens = clamp(length(col) * 0.60, 0.0, 1.0);
      vec3 lightOut = mix(lightBase, neb * 0.6, dens * 0.6);

      gl_FragColor = vec4(mix(lightOut, darkOut, uDark), 1.0);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[5IM nebula] shader error:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsrc);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  // full-screen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uDark = gl.getUniformLocation(prog, "uDark");

  // WebGL works → take over the background from the CSS blobs
  canvas.style.display = "block";
  document.documentElement.classList.add("has-nebula");

  // render at reduced internal resolution (cheap + softens nicely on upscale)
  const SCALE = 0.55;
  let cssW = 0, cssH = 0;
  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    const w = Math.max(2, Math.floor(cssW * SCALE));
    const h = Math.max(2, Math.floor(cssH * SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }
  window.addEventListener("resize", resize);

  // AutoSims is a single dark look — force the dark nebula regardless of the
  // theme class (the old light/dark toggle no longer changes the background).
  const darkVal = 1;

  // pause while the viewer is actually WATCHING (video on-screen + playing) so the
  // shader never competes with HLS decode — this is the anti-freeze guard.
  const video = document.getElementById("streamVideo");
  let videoOnScreen = false;
  if (video && "IntersectionObserver" in window) {
    new IntersectionObserver(
      (es) => { videoOnScreen = es.some((e) => e.isIntersecting); },
      { threshold: 0.25 }
    ).observe(video);
  }
  const watching = () => videoOnScreen && video && !video.paused && video.readyState >= 2 && video.videoWidth > 0;

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  resize();

  let tSec = 0;
  let prev = 0;
  let lastDraw = 0;
  const FRAME = 1000 / 30; // 30fps cap

  function draw() {
    gl.uniform1f(uTime, tSec);
    gl.uniform1f(uDark, darkVal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = prev ? now - prev : 16;
    prev = now;
    if (document.hidden || watching()) return;        // freeze (last frame stays)
    if (now - lastDraw < FRAME) return;               // 30fps cap
    lastDraw = now;
    tSec += dt * 0.001;                               // advance only while animating
    draw();
  }

  let raf;
  if (reduced) {
    draw(); // one static frame, no animation
  } else {
    raf = requestAnimationFrame(loop);
  }

  // redraw once when coming back to a foreground tab so it's never stale on resume
  document.addEventListener("visibilitychange", () => { if (!document.hidden) prev = 0; });
})();
