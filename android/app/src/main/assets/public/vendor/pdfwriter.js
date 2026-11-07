// 아주 작은 PDF 작성기: 쪽마다 JPEG 그림 한 장을 쪽 전체에 채워 넣음 (외부 라이브러리 없음).
// pages: [{ jpeg: Uint8Array, w: 그림 가로 px, h: 그림 세로 px, pw: 쪽 가로 pt, ph: 쪽 세로 pt }]
window.PdfWriter = (() => {
  const enc = new TextEncoder();
  function build(pages, title) {
    const chunks = [];
    let length = 0;
    const offsets = [];
    const push = (data) => { const b = typeof data === "string" ? enc.encode(data) : data; chunks.push(b); length += b.length; };
    const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
    const n = pages.length;
    const pageId = (i) => 3 + i * 3, contentId = (i) => 4 + i * 3, imageId = (i) => 5 + i * 3;
    const infoId = 3 + n * 3;
    // PDF 문자열: 한글 제목은 UTF-16BE (FEFF) 16진수로
    const hexTitle = "FEFF" + Array.from(String(title || "Document")).map((ch) => {
      const c = ch.codePointAt(0);
      if (c > 0xffff) { const v = c - 0x10000; return ((0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0")); }
      return c.toString(16).padStart(4, "0");
    }).join("").toUpperCase();

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`));
    pages.forEach((pg, i) => {
      const pw = pg.pw.toFixed(2), ph = pg.ph.toFixed(2);
      obj(pageId(i), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imageId(i)} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId(i)} 0 R >>`));
      const stream = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      obj(contentId(i), () => { push(`<< /Length ${stream.length} >>\nstream\n`); push(stream); push("\nendstream"); });
      obj(imageId(i), () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
        push(pg.jpeg);
        push("\nendstream");
      });
    });
    obj(infoId, () => push(`<< /Title <${hexTitle}> /Producer (Document Viewer) >>`));
    const xref = length;
    let x = `xref\n0 ${infoId + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= infoId; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    push(x);
    push(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality || 0.85));
    return new Uint8Array(await blob.arrayBuffer());
  }

  return { build, canvasToJpeg };
})();
