// _jersey_color_probe.js — QUANTITATIVE jersey/helmet color QA.
//
// Eyeballing 32 teams' uniforms is unreliable (subtle shades, cel-shade tint
// bands). This renders the REAL sprite tint (drawPlayerSprite → _tintedSprite)
// for every team's primary color in headless Chromium, then MEASURES each region
// against the team color instead of guessing:
//   • JERSEY  — hue drift + chroma ratio + ΔE vs the team primary, and the
//               fraction of pixels that are an EXACT primary match (the tint's
//               mid band). Catches "wrong color / washed-out / pinked red".
//   • HELMET  — fraction team-colored (catches the white-helmet-vanish bug).
//   • PANTS   — fraction still white (must stay white) + speckle fraction
//               (stray tinted pixels = the polka-dot artifact).
//   • FACE    — fraction skin-toned (skin/facemask must survive the tint).
// Uses the engine's own isWhite/isSkin tests so classification matches the tint.
//
//   node tools/_jersey_color_probe.js [pose]      default pose: run
//   → /tmp/jersey_color_sheet.png (contact sheet) + /tmp/jersey_color_report.json
//   exit 0 = all teams within tolerance · 1 = flagged team(s)
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const POSE = process.argv[2] || "run";
const PW = (() => { try { require.resolve("playwright"); return "playwright"; } catch (e) {} return "/opt/node22/lib/node_modules/playwright"; })();
const { chromium } = require(PW);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

function staticServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/play.html";
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const srv = await staticServer();
  const port = srv.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message.slice(0, 140)));
  await page.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for the sprite atlas to actually have the pose loaded (drawPlayerSprite
  // returns false until the frame is in cache).
  await page.waitForFunction((pose) => {
    if (typeof window.drawPlayerSprite !== "function") return false;
    const cv = document.createElement("canvas"); cv.width = 120; cv.height = 120;
    const ctx = cv.getContext("2d"); ctx.translate(60, 92);
    return window.drawPlayerSprite(ctx, pose, 0, 0, 5, "#ff0000", 1, "", "#ffffff", {}) === true;
  }, POSE, { timeout: 20000 }).catch(() => {});

  const out = await page.evaluate(({ pose }) => {
    // ── color math (sRGB → CIELAB, ΔE76, hue/chroma) ──
    const hex2rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
    const lin = c => { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
    const rgb2lab = ([r,g,b]) => {
      const R=lin(r),G=lin(g),B=lin(b);
      let X=(R*0.4124+G*0.3576+B*0.1805)/0.95047, Y=R*0.2126+G*0.7152+B*0.0722, Z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
      const f=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
      X=f(X);Y=f(Y);Z=f(Z);
      return [116*Y-16, 500*(X-Y), 200*(Y-Z)];
    };
    const dE = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    const chroma = lab => Math.hypot(lab[1],lab[2]);
    const hue = lab => (Math.atan2(lab[2],lab[1])*180/Math.PI+360)%360;
    const hueDiff = (a,b) => { let d=Math.abs(a-b)%360; return d>180?360-d:d; };
    const isSkin = (r,g,b) => r>120&&g>50&&g<170&&b<110&&r>=g-5&&g>=b-5;   // engine's test

    const teams = (typeof TEAMS !== "undefined" ? TEAMS : []).map(t => ({ name: t.abbr || t.name || ("T"+t.id), primary: t.primary, secondary: t.secondary }));
    const stress = [
      { name: "pureRED", primary: "#FF0000", secondary: "#FFFFFF" },
      { name: "orange",  primary: "#FB4F14", secondary: "#FFFFFF" },  // satisfies isSkin → the trap
      { name: "black",   primary: "#101820", secondary: "#FFFFFF" },
      { name: "gold",    primary: "#FFB612", secondary: "#101820" },
    ];
    const tests = teams.concat(stress);

    const W = 120, H = 120;
    const render = (color) => {
      const cv = document.createElement("canvas"); cv.width=W; cv.height=H;
      const ctx = cv.getContext("2d"); ctx.save(); ctx.translate(60, 92);
      const ok = window.drawPlayerSprite(ctx, pose, 0, 0, 5, color, 1, "", "#ffffff", {});
      ctx.restore();
      return ok ? ctx.getImageData(0,0,W,H).data : null;
    };

    // ── DIFFERENTIAL MASK: render two very different tints; pixels that CHANGE
    //    are the tintable jersey/helmet (color-independent), pixels that don't
    //    are skin / white pants / ink outline. This is robust to warm team
    //    colors that themselves look like skin — the flaw in naive output
    //    classification. ──
    const A = render("#FF00FF"), B = render("#00FFFF");
    if (!A || !B) return { results: [], sheet: null, error: "sprite did not render" };
    let minX=W,minY=H,maxX=0,maxY=0;
    const tintable = new Uint8Array(W*H), opaque = new Uint8Array(W*H);
    let skinSurvive = 0, opaqueCount = 0;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      const p=y*W+x, i=p*4;
      if (A[i+3] < 200) continue;
      opaque[p]=1; opaqueCount++;
      if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
      const diff = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2]));
      if (diff > 40) tintable[p]=1;
      else if (isSkin(A[i],A[i+1],A[i+2])) skinSurvive++;   // skin invariant under tint = preserved
    }
    const bh = maxY-minY+1;
    const skinFrac = opaqueCount ? skinSurvive/opaqueCount : 0;   // pose-level (color-independent)
    const bandRows = (f0,f1) => [Math.round(minY+f0*bh), Math.round(minY+f1*bh)];

    const analyze = (data, primHex) => {
      const prim = hex2rgb(primHex), pLab = rgb2lab(prim), pHue = hue(pLab), pChroma = chroma(pLab);
      const greyish = pChroma < 12;
      // JERSEY strip (0.40–0.56): mean of the TINTABLE pixels only
      const [jy0,jy1] = bandRows(0.40,0.56);
      let jr=0,jg=0,jb=0,jn=0,exact=0;
      for (let y=jy0;y<=jy1;y++) for (let x=minX;x<=maxX;x++){ const p=y*W+x; if(!tintable[p])continue; const i=p*4;
        jr+=data[i]; jg+=data[i+1]; jb+=data[i+2]; jn++;
        if (dE(rgb2lab([data[i],data[i+1],data[i+2]]), pLab) < 12) exact++; }
      const mean = jn ? [jr/jn,jg/jn,jb/jn] : null;
      const mLab = mean ? rgb2lab(mean) : null;
      const exactFrac = jn ? exact/jn : 0;
      // HELMET dome (0–0.22): tintable coverage (catches white-helmet vanish)
      const [hy0,hy1]=bandRows(0,0.22); let ht=0,ho=0;
      for (let y=hy0;y<=hy1;y++) for (let x=minX;x<=maxX;x++){ const p=y*W+x; if(opaque[p]){ho++; if(tintable[p])ht++;} }
      const helmetFrac = ho ? ht/ho : 0;
      // PANTS (0.62–0.85): tintable bleed = real jersey-color speckle (dark legs
      // are NOT tintable, so this is clean now)
      const [py0,py1]=bandRows(0.62,0.85); let pt=0,po=0;
      for (let y=py0;y<=py1;y++) for (let x=minX;x<=maxX;x++){ const p=y*W+x; if(opaque[p]){po++; if(tintable[p])pt++;} }
      const speckle = po ? pt/po : 0;

      const hd = mLab ? hueDiff(hue(mLab), pHue) : null;
      const cr = mLab ? chroma(mLab)/Math.max(1,pChroma) : null;
      const de = mLab ? dE(mLab, pLab) : null;
      const flags = [];
      if (exactFrac < 0.08) flags.push("no-exact-band");
      if (!greyish && hd != null && hd > 18) flags.push("hue" + Math.round(hd));
      if (!greyish && cr != null && cr < 0.5) flags.push("washed" + cr.toFixed(2));
      if (helmetFrac < 0.12) flags.push("helmet-uncolored");
      if (speckle > 0.12) flags.push("pants-speckle" + speckle.toFixed(2));
      const r1 = v => v==null?null:Math.round(v*10)/10, r2 = v => v==null?null:Math.round(v*100)/100;
      return { jerseyDE:r1(de), hueDrift:r1(hd), chroma:r2(cr), exactFrac:r2(exactFrac),
               helmet:r2(helmetFrac), speckle:r2(speckle), greyish, flags };
    };

    const cell = 120, cols = 9, rows = Math.ceil(tests.length / cols);
    const sheet = document.createElement("canvas"); sheet.width = cols*cell; sheet.height = rows*(cell+22);
    const sx = sheet.getContext("2d"); sx.fillStyle = "#0c160c"; sx.fillRect(0,0,sheet.width,sheet.height);

    const results = [];
    for (let i=0;i<tests.length;i++){
      const tc = tests[i];
      const data = render(tc.primary);
      const m = data ? analyze(data, tc.primary) : { flags:["not-drawn"] };
      m.name = tc.name; m.primary = tc.primary;
      results.push(m);
      // contact sheet: target swatch + tinted sprite + label
      const cx0 = (i%cols)*cell, cy0 = Math.floor(i/cols)*(cell+22);
      sx.fillStyle = tc.primary; sx.fillRect(cx0+3, cy0+3, 14, 14);
      sx.strokeStyle = "#0008"; sx.strokeRect(cx0+3, cy0+3, 14, 14);
      if (data) { const tmp=document.createElement("canvas"); tmp.width=W; tmp.height=H; tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data),W,H),0,0); sx.drawImage(tmp, cx0, cy0); }
      sx.font = "10px monospace"; sx.textAlign = "center";
      sx.fillStyle = (m.flags && m.flags.length) ? "#ffd23f" : "#86efac";
      sx.fillText(tc.name + (m.flags && m.flags.length ? " ⚑" : ""), cx0+cell/2, cy0+cell+11);
      sx.fillStyle = "#94a3b8";
      sx.fillText("ΔE" + (m.jerseyDE??"–") + " hue" + (m.hueDrift??"–"), cx0+cell/2, cy0+cell+20);
    }
    return { results, sheet: sheet.toDataURL("image/png"), skinFrac: Math.round(skinFrac*1000)/1000, tintablePx: tintable.reduce((a,b)=>a+b,0) };
  }, { pose: POSE });

  await browser.close();
  srv.close();

  fs.writeFileSync("/tmp/jersey_color_sheet.png", Buffer.from(out.sheet.split(",")[1], "base64"));
  fs.writeFileSync("/tmp/jersey_color_report.json", JSON.stringify(out.results, null, 1));

  if (out.error) { console.log("✗", out.error); process.exit(2); }
  const flagged = out.results.filter(r => r.flags && r.flags.length);
  console.log(`\nJERSEY/HELMET COLOR PROBE — pose=${POSE} · ${out.results.length} colors · ${errs.length} page errors`);
  console.log(` pose-level: bare-skin fraction=${out.skinFrac} (color-independent; ~0 ⇒ skin eaten by tint), tintable px=${out.tintablePx}`);
  console.log("─".repeat(86));
  console.log("  team        jerseyΔE  hueΔ  chroma  exact  helmet  speckle   flags");
  for (const r of out.results) {
    const c = (v,w) => String(v==null?"–":v).padStart(w);
    console.log(`  ${r.name.padEnd(10)} ${c(r.jerseyDE,8)} ${c(r.hueDrift,5)} ${c(r.chroma,7)} ${c(r.exactFrac,6)} ${c(r.helmet,7)} ${c(r.speckle,8)}   ${(r.flags||[]).join(",")}`);
  }
  console.log("─".repeat(86));
  console.log(` ${flagged.length} flagged / ${out.results.length}.  Sheet → /tmp/jersey_color_sheet.png · report → /tmp/jersey_color_report.json`);
  if (errs.length) console.log(" page errors:", errs.slice(0,3).join(" | "));
  process.exit(flagged.length ? 1 : 0);
})();
