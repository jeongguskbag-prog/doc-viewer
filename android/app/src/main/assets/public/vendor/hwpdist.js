// HWP 배포용 문서(ViewText) 열기.
// 배포용 문서는 본문이 BodyText 대신 암호화된 ViewText/SectionN 에 들어 있다. 공개된 HWP 5.0 형식 설명에 따라
//  1) 각 구역 맨 앞 레코드(HWPTAG_DISTRIBUTE_DOC_DATA, 256바이트)의 앞 4바이트를 씨앗으로
//     MSVC rand() 와 같은 난수열을 만들어 나머지 바이트를 XOR 로 푼다
//  2) 풀린 데이터의 4 + (씨앗 & 0x0F) 위치에서 16바이트를 AES-128 열쇠로 쓴다
//  3) 레코드 뒤 나머지를 AES-128-ECB 로 풀면 일반 BodyText 구역과 같은 내용이 된다
// 이렇게 만든 구역으로 일반 HWP 를 다시 조립해 기존 HWP 보기로 넘긴다. (외부 라이브러리: SheetJS 의 CFB 만 사용)
window.HwpDist = (() => {
  // ---------- AES-128 해독 (ECB) ----------
  const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
  (() => {
    let p = 1, q = 1;
    do {
      p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
      const x = q ^ ((q << 1 | q >> 7) & 0xff) ^ ((q << 2 | q >> 6) & 0xff) ^ ((q << 3 | q >> 5) & 0xff) ^ ((q << 4 | q >> 4) & 0xff) ^ 0x63;
      SBOX[p] = x; INV[x] = p;
    } while (p !== 1);
    SBOX[0] = 0x63; INV[0x63] = 0;
  })();
  const xt = (b) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
  const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
  function expandKey(key) {
    const w = new Uint8Array(176); w.set(key);
    let rcon = 1;
    for (let i = 16; i < 176; i += 4) {
      let t = w.slice(i - 4, i);
      if (i % 16 === 0) {
        t = new Uint8Array([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]);
        rcon = xt(rcon);
      }
      for (let j = 0; j < 4; j++) w[i + j] = w[i - 16 + j] ^ t[j];
    }
    return w;
  }
  function decryptBlock(s, w) {
    const add = (r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
    const invShift = () => { const t = s.slice(); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[((c + r) % 4) * 4 + r] = t[c * 4 + r]; };
    const invSub = () => { for (let i = 0; i < 16; i++) s[i] = INV[s[i]]; };
    const invMix = () => {
      for (let c = 0; c < 4; c++) {
        const a = s.slice(c * 4, c * 4 + 4);
        s[c * 4] = mul(a[0], 14) ^ mul(a[1], 11) ^ mul(a[2], 13) ^ mul(a[3], 9);
        s[c * 4 + 1] = mul(a[0], 9) ^ mul(a[1], 14) ^ mul(a[2], 11) ^ mul(a[3], 13);
        s[c * 4 + 2] = mul(a[0], 13) ^ mul(a[1], 9) ^ mul(a[2], 14) ^ mul(a[3], 11);
        s[c * 4 + 3] = mul(a[0], 11) ^ mul(a[1], 13) ^ mul(a[2], 9) ^ mul(a[3], 14);
      }
    };
    add(10);
    for (let r = 9; r >= 1; r--) { invShift(); invSub(); add(r); invMix(); }
    invShift(); invSub(); add(0);
    return s;
  }
  function aesEcbDecrypt(key, data) {
    const w = expandKey(key);
    const n = data.length - (data.length % 16);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 16) out.set(decryptBlock(data.slice(i, i + 16), w), i);
    return out;
  }

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
