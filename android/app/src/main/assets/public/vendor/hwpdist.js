// HWP 배포용 문서(ViewText) 열기.
// 배포용 문서는 본문이 BodyText 대신 암호화된 ViewText/SectionN 에 들어 있다. 공개된 HWP 5.0 형식 설명에 따라
//  1) 각 구역 맨 앞 레코드(HWPTAG_DISTRIBUTE_DOC_DATA, 256바이트)의 앞 4바이트를 씨앗으로
//     MSVC rand() 와 같은 난수열을 만들어 나머지 바이트를 XOR 로 푼다
//  2) 풀린 데이터의 4 + (씨앗 & 0x0F) 위치에서 16바이트를 AES-128 열쇠로 쓴다
//  3) 레코드 뒤 나머지를 AES-128-ECB 로 풀면 일반 BodyText 구역과 같은 내용이 된다
// 이렇게 만든 구역으로 일반 HWP 를 다시 조립해 기존 HWP 보기로 넘긴다. (SheetJS 의 CFB, vendor/aes.js 사용)
window.HwpDist = (() => {
  // AES 해독은 vendor/aes.js (window.AES) 를 씀
  const aesEcbDecrypt = (key, data) => AES.ecbDecrypt(key, data);

  // ---------- 배포용 구역 해독 ----------
  function decodeSection(bytes) {
    const h = (bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24) >>> 0;
    let size = (h >>> 20) & 0xfff, at = 4;
    if (size === 0xfff) { size = (bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24) >>> 0; at = 8; }
    if (size !== 256 || bytes.length < at + 256) throw Object.assign(new Error("bad distribution record"), { code: "corrupt" });
    const data = bytes.slice(at, at + 256);
    const seed = (data[0] | data[1] << 8 | data[2] << 16 | data[3] << 24) >>> 0;
    let state = seed, n = 0, x = 0;
    const rand = () => { state = (Math.imul(state, 214013) + 2531011) >>> 0; return (state >>> 16) & 0x7fff; };
    for (let i = 0; i < 256; i++) {
      if (n === 0) { x = rand() & 0xff; n = (rand() & 0x0f) + 1; }
      if (i >= 4) data[i] ^= x;
      n--;
    }
    const off = 4 + (seed & 0x0f);
    const key = data.slice(off, off + 16);
    return aesEcbDecrypt(key, bytes.slice(at + 256));
  }

  const flagsOf = (fh) => (fh[36] | fh[37] << 8 | fh[38] << 16 | fh[39] << 24) >>> 0;

  /** 배포용 문서이면 일반 HWP 바이트로 바꿔 돌려주고, 아니면 null */
  function toNormal(bytes) {
    const CFB = XLSX.CFB;
    const cfb = CFB.read(bytes, { type: "array" });
    const fh = CFB.find(cfb, "/FileHeader");
    if (!fh || !(flagsOf(fh.content) & 4)) return null;
    const sections = cfb.FullPaths
      .map((p, i) => ({ p, e: cfb.FileIndex[i] }))
      .filter(({ p }) => /\/ViewText\/Section\d+$/.test(p))
      .sort((a, b) => +a.p.match(/(\d+)$/)[1] - +b.p.match(/(\d+)$/)[1]);
    if (!sections.length) return null;
    for (const { p, e } of sections) {
      const plain = decodeSection(new Uint8Array(e.content));
      CFB.utils.cfb_add(cfb, "/BodyText/Section" + p.match(/(\d+)$/)[1], plain);
    }
    for (const { p } of sections) CFB.utils.cfb_del(cfb, p.replace(/^[^/]*\//, "/"));
    CFB.utils.cfb_gc(cfb); // 지운 뒤 정리하지 않으면 파일 구조가 깨짐
    // 배포용 표시(비트 2)를 지워 일반 HWP 로 읽히게 함
    const head = new Uint8Array(fh.content);
    const flags = flagsOf(head) & ~4;
    head[36] = flags & 0xff; head[37] = (flags >>> 8) & 0xff; head[38] = (flags >>> 16) & 0xff; head[39] = (flags >>> 24) & 0xff;
    fh.content = head;
    return new Uint8Array(CFB.write(cfb, { type: "array", fileType: "cfb" }));
  }

  return { toNormal, _aesEcbDecrypt: aesEcbDecrypt, _decodeSection: decodeSection };
})();
