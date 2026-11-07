// PPTX(PowerPoint) 보기: 슬라이드를 원래 배치대로 HTML 로 그림.
// - 압축 풀기: SheetJS 에 들어 있는 CFB(zip) 리더 (XLSX.CFB)
// - 지원: 글상자(위치·크기·글꼴 크기·굵게/기울임/밑줄·색·정렬·글머리표), 그림, 표(병합), 그룹, 도형 채우기·테두리,
//         배경색/배경 그림, 레이아웃·마스터에서 물려받는 자리 표시자 위치, 테마 색(밝기 조절 포함)
// - 미지원: 애니메이션, 차트, SmartArt, 수식, 동영상 (자리만 비워 둠)
// 글꼴 크기는 슬라이드 폭 기준(cqw)이라 창 크기와 상관없이 비율이 유지됨.
window.PptxView = (() => {
  const NS_ANY = "*";
  const kids = (el, name) => el ? Array.from(el.children).filter((c) => c.localName === name) : [];
  const kid = (el, name) => kids(el, name)[0] || null;
  const desc = (el, name) => el ? el.getElementsByTagNameNS(NS_ANY, name)[0] || null : null;
  const descAll = (el, name) => el ? Array.from(el.getElementsByTagNameNS(NS_ANY, name)) : [];
  const attr = (el, name) => el ? el.getAttribute(name) : null;
  const num = (v, d = 0) => (v == null || v === "" || isNaN(+v) ? d : +v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function unzip(buf) {
    const cfb = XLSX.CFB.read(new Uint8Array(buf), { type: "array" });
    return {
      bytes(path) {
        const e = XLSX.CFB.find(cfb, "/" + path.replace(/^\/+/, ""));
        return e && e.content && e.content.length ? new Uint8Array(e.content) : null;
      },
      text(path) { const b = this.bytes(path); return b ? new TextDecoder("utf-8").decode(b) : null; },
    };
  }

  function parseXml(s) { return s ? new DOMParser().parseFromString(s, "application/xml") : null; }

  // "ppt/slides/slide1.xml" 기준으로 "../media/image1.png" → "ppt/media/image1.png"
  function resolvePath(base, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/"); parts.pop();
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }
  function relsOf(zip, path) {
    const dir = path.split("/"); const file = dir.pop();
    const xml = parseXml(zip.text(dir.concat("_rels", file + ".rels").join("/")));
    const map = {};
    if (xml) for (const r of descAll(xml, "Relationship")) {
      if (attr(r, "TargetMode") === "External") continue;
      map[attr(r, "Id")] = { type: attr(r, "Type") || "", path: resolvePath(path, attr(r, "Target") || "") };
    }
    return map;
  }

  // ---------- 색 ----------
  function hexToRgb(h) { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    return [h, s, l];
  }
  function hslToHex([h, s, l]) {
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    let r, g, b;
    if (s === 0) r = g = b = l; else { const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
    return "#" + [r, g, b].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("");
  }
  const DEFAULT_THEME = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };
  function parseTheme(xml) {
    const t = Object.assign({}, DEFAULT_THEME);
    const scheme = desc(xml, "clrScheme");
    if (scheme) for (const c of Array.from(scheme.children)) {
      const srgb = kid(c, "srgbClr"), sys = kid(c, "sysClr");
      if (srgb) t[c.localName] = attr(srgb, "val"); else if (sys) t[c.localName] = attr(sys, "lastClr") || t[c.localName];
    }
    return t;
  }
  // a:solidFill 등 안의 색 요소 → "#rrggbb"
  function colorOf(fillEl, theme) {
    if (!fillEl) return null;
    const c = Array.from(fillEl.children).find((e) => ["srgbClr", "schemeClr", "sysClr", "prstClr"].includes(e.localName));
    if (!c) return null;
    let hex;
    if (c.localName === "srgbClr") hex = attr(c, "val");
    else if (c.localName === "sysClr") hex = attr(c, "lastClr") || "000000";
    else if (c.localName === "prstClr") hex = ({ black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", yellow: "FFFF00" })[attr(c, "val")] || "000000";
    else {
      const key = ({ bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" })[attr(c, "val")] || attr(c, "val");
      hex = theme[key] || "000000";
    }
    if (!/^[0-9a-f]{6}$/i.test(hex || "")) return null;
    let hsl = rgbToHsl(hexToRgb(hex));
    const lumMod = kid(c, "lumMod"), lumOff = kid(c, "lumOff"), tint = kid(c, "tint"), shade = kid(c, "shade");
    if (lumMod) hsl[2] *= num(attr(lumMod, "val"), 100000) / 100000;
    if (lumOff) hsl[2] += num(attr(lumOff, "val"), 0) / 100000;
    if (tint) hsl[2] += (1 - hsl[2]) * (1 - num(attr(tint, "val"), 100000) / 100000);
    if (shade) hsl[2] *= num(attr(shade, "val"), 100000) / 100000;
    const alpha = kid(c, "alpha");
    const out = hslToHex(hsl);
    if (alpha) { const [r, g, b] = hexToRgb(out.slice(1)); return `rgba(${r},${g},${b},${(num(attr(alpha, "val"), 100000) / 100000).toFixed(2)})`; }
    return out;
  }

  // ---------- 읽기 ----------
  async function render(buf) {
    const zip = unzip(buf);
    const presPath = "ppt/presentation.xml";
    const pres = parseXml(zip.text(presPath));
    if (!pres) throw Object.assign(new Error("not a pptx"), { code: "notPptx" });
    const sz = desc(pres, "sldSz");
    const W = num(attr(sz, "cx"), 12192000), H = num(attr(sz, "cy"), 6858000);
    const presRels = relsOf(zip, presPath);
    const urls = [];
    const xmlCache = {}, relCache = {};
    const xmlOf = (p) => (p in xmlCache ? xmlCache[p] : (xmlCache[p] = parseXml(zip.text(p))));
    const relOf = (p) => (p in relCache ? relCache[p] : (relCache[p] = relsOf(zip, p)));
    const relByType = (rels, suffix) => Object.values(rels).find((r) => r.type.endsWith(suffix));
    const themeRel = relByType(presRels, "/theme");
    let theme = DEFAULT_THEME;
    const imageUrl = (path) => {
      const b = zip.bytes(path); if (!b) return null;
      const ext = (path.split(".").pop() || "").toLowerCase();
      const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp" })[ext];
      if (!mime) return null; // emf/wmf 등은 브라우저가 못 그림
      const u = URL.createObjectURL(new Blob([b], { type: mime })); urls.push(u); return u;
    };

    const pct = (v, total) => (v / total * 100).toFixed(4) + "%";
    const cqw = (pt) => (pt * 12700 / W * 100).toFixed(4) + "cqw"; // 글꼴 크기: 슬라이드 폭 기준

    // 자리 표시자 위치를 레이아웃 → 마스터에서 찾음
    function phInfo(sp) { const ph = desc(kid(sp, "nvSpPr") || kid(sp, "nvPicPr") || sp, "ph"); return ph ? { type: attr(ph, "type") || "body", idx: attr(ph, "idx") } : null; }
    function findPh(tree, ph) {
      if (!tree) return null;
      const all = descAll(tree, "sp");
      const same = (t) => t === ph.type || (["title", "ctrTitle"].includes(t) && ["title", "ctrTitle"].includes(ph.type));
      return all.find((s) => { const p = phInfo(s); return p && ph.idx != null && p.idx === ph.idx; })
        || all.find((s) => { const p = phInfo(s); return p && same(p.type); }) || null;
    }
    function xfrmOf(el) {
      const x = desc(kid(el, "spPr") || kid(el, "grpSpPr") || el, "xfrm") || kid(el, "xfrm");
      if (!x) return null;
      const off = kid(x, "off"), ext = kid(x, "ext");
      if (!off || !ext) return null;
      const r = { x: num(attr(off, "x")), y: num(attr(off, "y")), cx: num(attr(ext, "cx")), cy: num(attr(ext, "cy")), rot: num(attr(x, "rot")) / 60000 };
      const chOff = kid(x, "chOff"), chExt = kid(x, "chExt");
      if (chOff && chExt) r.ch = { x: num(attr(chOff, "x")), y: num(attr(chOff, "y")), cx: num(attr(chExt, "cx")) || 1, cy: num(attr(chExt, "cy")) || 1 };
      return r;
    }

    function styleChain(sp, ph, ctx) {
      const list = [];
      const own = kid(kid(sp, "txBody"), "lstStyle"); if (own) list.push(own);
      if (ph) {
        for (const tree of [ctx.layout, ctx.master]) {
          const t = findPh(tree, ph);
          const l = t && kid(kid(t, "txBody"), "lstStyle"); if (l) list.push(l);
        }
        const tx = ctx.master && desc(ctx.master, "txStyles");
        const name = ["title", "ctrTitle"].includes(ph.type) ? "titleStyle" : ["body", "obj", "subTitle"].includes(ph.type) ? "bodyStyle" : "otherStyle";
        const st = tx && kid(tx, name); if (st) list.push(st);
      } else if (ctx.defaultTextStyle) list.push(ctx.defaultTextStyle);
      return list;
    }
    function lvlProp(chain, lvl, fn) {
      for (const st of chain || []) { const l = kid(st, `lvl${lvl + 1}pPr`); if (l) { const v = fn(l); if (v != null) return v; } }
      return null;
    }
    function bodyPrChain(sp, ph, ctx, name) {
      const own = attr(kid(kid(sp, "txBody"), "bodyPr"), name); if (own != null) return own;
      if (ph) for (const tree of [ctx.layout, ctx.master]) { const t = findPh(tree, ph); const v = t && attr(kid(kid(t, "txBody"), "bodyPr"), name); if (v != null) return v; }
      return null;
    }

    function textHtml(txBody, ctx, ph, chain) {
      if (!txBody) return "";
      const isTitle = ph && ["title", "ctrTitle"].includes(ph.type);
      const defSize = isTitle ? 44 : 18;
      let out = "";
      for (const p of kids(txBody, "p")) {
        const pPr = kid(p, "pPr");
        const lvl = num(attr(pPr, "lvl"));
        const algn = attr(pPr, "algn") || lvlProp(chain, lvl, (l) => attr(l, "algn"));
        const align = ({ ctr: "center", r: "right", just: "justify", dist: "justify" })[algn] || "left";
        // 글머리표: 문단 설정 > 상속(레이아웃·마스터) 순
        let bu = null;
        if (kid(pPr, "buNone")) bu = "none";
        else if (kid(pPr, "buAutoNum")) bu = "num";
        else if (kid(pPr, "buChar")) bu = attr(kid(pPr, "buChar"), "char") || "•";
        else bu = lvlProp(chain, lvl, (l) => kid(l, "buNone") ? "none" : kid(l, "buAutoNum") ? "num" : kid(l, "buChar") ? (attr(kid(l, "buChar"), "char") || "•") : null);
        const defRPr = (k) => lvlProp(chain, lvl, (l) => attr(kid(l, "defRPr"), k));
        const defColor = lvlProp(chain, lvl, (l) => colorOf(kid(kid(l, "defRPr"), "solidFill"), ctx.theme));
        const endSz = num(attr(kid(p, "endParaRPr"), "sz"), 0) / 100;
        let runs = "", firstSize = null;
        for (const r of Array.from(p.children)) {
          if (r.localName === "br") { runs += "<br>"; continue; }
          if (r.localName !== "r" && r.localName !== "fld") continue;
          const rPr = kid(r, "rPr");
          const t = kid(r, "t");
          const text = t ? t.textContent : "";
          if (!text) continue;
          const size = num(attr(rPr, "sz"), 0) / 100 || num(defRPr("sz"), 0) / 100 || defSize;
          if (firstSize == null) firstSize = size;
          const css = [`font-size:${cqw(size)}`];
          const bold = attr(rPr, "b") ?? defRPr("b"); if (bold === "1") css.push("font-weight:700");
          if ((attr(rPr, "i") ?? defRPr("i")) === "1") css.push("font-style:italic");
          const u = attr(rPr, "u"); if (u && u !== "none") css.push("text-decoration:underline");
          if (attr(rPr, "strike") && attr(rPr, "strike") !== "noStrike") css.push("text-decoration:line-through");
          const col = colorOf(kid(rPr, "solidFill"), ctx.theme) || ctx.cellColor || defColor; if (col) css.push(`color:${col}`);
          const hl = colorOf(kid(rPr, "highlight"), ctx.theme); if (hl) css.push(`background:${hl}`);
          let h = esc(text);
          const link = desc(rPr, "hlinkClick");
          const rid = attr(link, "r:id") || (link && link.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
          if (rid && ctx.extLinks[rid]) h = `<a href="${esc(ctx.extLinks[rid])}">${h}</a>`;
          runs += `<span style="${css.join(";")}">${h}</span>`;
        }
        const size = firstSize || endSz || num(defRPr("sz"), 0) / 100 || defSize;
        const bullet = runs && bu && bu !== "none" && bu !== "num" ? `<span class="pp-bu">${esc(bu)}</span>` : "";
        const indent = lvl * 4;
        out += `<div class="pp-p" style="text-align:${align};font-size:${cqw(size)};margin-left:${indent}%">${bullet}${runs || "&nbsp;"}</div>`;
      }
      return out;
    }

    function shapeStyle(spPr, ctx) {
      const css = [];
      if (!spPr) return css;
      const fill = kid(spPr, "solidFill");
      const c = colorOf(fill, ctx.theme); if (c) css.push(`background:${c}`);
      const ln = kid(spPr, "ln");
      if (ln && !kid(ln, "noFill")) {
        const lc = colorOf(kid(ln, "solidFill"), ctx.theme);
        if (lc) css.push(`border:${Math.max(1, num(attr(ln, "w"), 12700) / 12700 * 96 / 72 / 2).toFixed(1)}px solid ${lc}`);
      }
      const geom = attr(desc(spPr, "prstGeom"), "prst");
      if (geom === "ellipse") css.push("border-radius:50%");
      else if (geom === "roundRect") css.push("border-radius:8%");
      return css;
    }

    function box(rect, t, extra) {
      const css = [`left:${pct(rect.x, W)}`, `top:${pct(rect.y, H)}`, `width:${pct(rect.cx, W)}`, `height:${pct(rect.cy, H)}`].concat(extra || []);
      if (rect.rot) css.push(`transform:rotate(${rect.rot}deg)`);
      return `<div class="pp-box" style="${css.join(";")}">${t}</div>`;
    }

    // 그룹 안 좌표를 슬라이드 좌표로
    const ident = (r) => r;
    function groupMap(g, outer) {
      if (!g || !g.ch) return outer;
      const sx = g.cx / g.ch.cx, sy = g.cy / g.ch.cy;
      return (r) => outer({ x: g.x + (r.x - g.ch.x) * sx, y: g.y + (r.y - g.ch.y) * sy, cx: r.cx * sx, cy: r.cy * sy, rot: r.rot });
    }

    function renderTree(tree, ctx, map) {
      let out = "";
      for (const el of Array.from(tree.children)) {
        const name = el.localName;
        if (name === "sp") {
          const ph = phInfo(el);
          if (ph && ["sldNum", "dt", "ftr"].includes(ph.type) && !desc(el, "t")) continue;
          let rect = xfrmOf(el);
          if (!rect && ph) rect = xfrmOf(findPh(ctx.layout, ph) || {}) || xfrmOf(findPh(ctx.master, ph) || {});
          if (!rect) continue;
          const body = kid(el, "txBody");
          const bodyPr = kid(body, "bodyPr");
          const anchor = bodyPrChain(el, ph, ctx, "anchor") || "t";
          const ins = (k, d) => pct(num(attr(bodyPr, k), d), W);
          const inner = `<div class="pp-txt" style="justify-content:${({ ctr: "center", b: "flex-end" })[anchor] || "flex-start"};padding:${ins("tIns", 45720)} ${ins("rIns", 91440)} ${ins("bIns", 45720)} ${ins("lIns", 91440)}">${textHtml(body, ctx, ph, styleChain(el, ph, ctx))}</div>`;
          out += box(map(rect), inner, shapeStyle(kid(el, "spPr"), ctx));
        } else if (name === "pic") {
          let rect = xfrmOf(el);
          const ph = phInfo(el);
          if (!rect && ph) rect = xfrmOf(findPh(ctx.layout, ph) || {});
          const blip = desc(el, "blip");
          const rid = blip && (attr(blip, "r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"));
          const rel = rid && ctx.rels[rid];
          const url = rel && imageUrl(rel.path);
          if (rect && url) out += box(map(rect), `<img src="${url}" alt="">`);
        } else if (name === "grpSp") {
          const g = xfrmOf(el);
          out += renderTree(el, ctx, groupMap(g, map));
        } else if (name === "graphicFrame") {
          const x = kid(el, "xfrm");
          const off = kid(x, "off"), ext = kid(x, "ext");
          if (!off || !ext) continue;
          const rect = { x: num(attr(off, "x")), y: num(attr(off, "y")), cx: num(attr(ext, "cx")), cy: num(attr(ext, "cy")) };
          const tbl = desc(el, "tbl");
          if (tbl) out += box(map(rect), tableHtml(tbl, ctx), ["overflow:visible"]);
          else out += box(map(rect), `<div class="pp-unsup">📊</div>`); // 차트·SmartArt 등
        }
      }
      return out;
    }

    function tableHtml(tbl, ctx) {
      const tblPr = kid(tbl, "tblPr");
      const firstRow = attr(tblPr, "firstRow") === "1", bandRow = attr(tblPr, "bandRow") === "1";
      const accent = "#" + (ctx.theme.accent1 || "4472C4");
      const band = hslToHex((([h, s2]) => [h, s2, .9])(rgbToHsl(hexToRgb(accent.slice(1)))));
      const band2 = hslToHex((([h, s2]) => [h, s2, .82])(rgbToHsl(hexToRgb(accent.slice(1)))));
      const cols = descAll(kid(tbl, "tblGrid"), "gridCol").map((c) => num(attr(c, "w")));
      const total = cols.reduce((a, b) => a + b, 0) || 1;
      let h = `<table class="pp-tbl"><colgroup>${cols.map((w) => `<col style="width:${(w / total * 100).toFixed(3)}%">`).join("")}</colgroup>`;
      kids(tbl, "tr").forEach((tr, ri) => {
        h += "<tr>";
        const head = firstRow && ri === 0;
        for (const tc of kids(tr, "tc")) {
          if (attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1") continue;
          const cs = num(attr(tc, "gridSpan"), 1), rs = num(attr(tc, "rowSpan"), 1);
          const tcPr = kid(tc, "tcPr");
          const bg = colorOf(kid(tcPr, "solidFill"), ctx.theme) || (head ? accent : bandRow ? ((ri - (firstRow ? 1 : 0)) % 2 ? band : band2) : null);
          const cellCtx = head && !colorOf(kid(tcPr, "solidFill"), ctx.theme) ? Object.assign({}, ctx, { cellColor: "#ffffff" }) : ctx;
          h += `<td${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""} style="${bg ? `background:${bg};` : ""}${head ? "font-weight:700;" : ""}">${textHtml(kid(tc, "txBody"), cellCtx, null, ctx.defaultTextStyle ? [ctx.defaultTextStyle] : [])}</td>`;
        }
        h += "</tr>";
      });
      return h + "</table>";
    }

    function bgOf(doc, rels, ctx) {
      const bgPr = doc && desc(doc, "bgPr");
      if (bgPr) {
        const c = colorOf(kid(bgPr, "solidFill"), ctx.theme);
        if (c) return `background:${c}`;
        const blip = desc(bgPr, "blip");
        const rid = blip && (attr(blip, "r:embed") || blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"));
        const url = rid && rels[rid] && imageUrl(rels[rid].path);
        if (url) return `background:url(${url}) center/cover no-repeat`;
        const grad = desc(bgPr, "gradFill");
        if (grad) { const stops = descAll(grad, "gs").map((g) => colorOf(g, ctx.theme)).filter(Boolean); if (stops.length) return `background:linear-gradient(${stops.join(",")})`; }
      }
      const bgRef = doc && desc(doc, "bgRef");
      if (bgRef) { const c = colorOf(bgRef, ctx.theme); if (c) return `background:${c}`; }
      return null;
    }

    const slideIds = descAll(desc(pres, "sldIdLst"), "sldId");
    let html = "", text = [];
    let n = 0;
    for (const sid of slideIds) {
      const rid = attr(sid, "r:id") || sid.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const rel = presRels[rid];
      if (!rel) continue;
      const slide = xmlOf(rel.path);
      if (!slide || attr(slide.documentElement, "show") === "0") continue;
      const rels = relOf(rel.path);
      const layoutRel = relByType(rels, "/slideLayout");
      const layout = layoutRel ? xmlOf(layoutRel.path) : null;
      const masterRel = layoutRel ? relByType(relOf(layoutRel.path), "/slideMaster") : null;
      const master = masterRel ? xmlOf(masterRel.path) : null;
      if (masterRel && n === 0) {
        const tr = relByType(relOf(masterRel.path), "/theme") || themeRel;
        if (tr) theme = parseTheme(xmlOf(tr.path));
      }
      const extLinks = {};
      const relXml = parseXml(zip.text(rel.path.replace(/([^/]+)$/, "_rels/$1.rels")));
      if (relXml) for (const r of descAll(relXml, "Relationship")) if (attr(r, "TargetMode") === "External") extLinks[attr(r, "Id")] = attr(r, "Target");
      const ctx = { theme, rels, layout, master, extLinks, defaultTextStyle: desc(pres, "defaultTextStyle") };
      const bg = bgOf(slide, rels, ctx) || (layout && bgOf(layout, relOf(layoutRel.path), ctx)) || (master && bgOf(master, relOf(masterRel.path), ctx)) || "background:#fff";
      // 레이아웃·마스터의 고정 그림(로고 등)은 자리 표시자가 아닌 것만
      const decor = (doc) => {
        const tree = doc && desc(doc, "spTree");
        if (!tree) return "";
        const clone = tree.cloneNode(true);
        for (const c of Array.from(clone.children)) if (c.localName === "sp" && phInfo(c)) c.remove();
        return renderTree(clone, ctx, ident);
      };
      const showMaster = attr(slide.documentElement, "showMasterSp") !== "0";
      const body = (showMaster ? decor(master) + decor(layout) : "") + renderTree(desc(slide, "spTree"), ctx, ident);
      n++;
      html += `<section class="pp-slide" style="aspect-ratio:${W}/${H};${bg}" data-slide="${n}"><div class="pp-no">${n}</div>${body}</section>`;
      text.push(descAll(slide, "t").map((t) => t.textContent).join(" "));
    }
    if (!n) throw Object.assign(new Error("no slides"), { code: "noSlides" });
    return { html, text: text.join("\n"), slides: n, urls };
  }

  return { render };
})();
