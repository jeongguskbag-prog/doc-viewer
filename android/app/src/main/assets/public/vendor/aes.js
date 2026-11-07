// AES (128/192/256) 블록 암호 — 외부 라이브러리 없이 기기 안에서만 동작.
// 쓰는 곳: 배포용 HWP 해독(ECB), 암호 걸린 ZIP 해독(WinZip AES = CTR, 카운터는 리틀엔디언)
// 브라우저 WebCrypto 는 ECB 와 리틀엔디언 CTR 을 지원하지 않아 직접 구현함.
window.AES = (() => {
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

  // 열쇠 확장: 16/24/32 바이트 → 라운드 열쇠
  function expandKey(key) {
    const nk = key.length / 4, rounds = nk + 6, total = 16 * (rounds + 1);
    const w = new Uint8Array(total); w.set(key);
    let rcon = 1;
    for (let i = key.length; i < total; i += 4) {
      let t = w.slice(i - 4, i);
      if ((i / 4) % nk === 0) { t = new Uint8Array([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]); rcon = xt(rcon); }
      else if (nk > 6 && (i / 4) % nk === 4) t = t.map((b) => SBOX[b]);
      for (let j = 0; j < 4; j++) w[i + j] = w[i - key.length + j] ^ t[j];
    }
    return { w, rounds };
  }

  function encryptBlock(s, { w, rounds }) {
    const add = (r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
    const sub = () => { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; };
    const shift = () => { const t = s.slice(); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r]; };
    const mix = () => {
      for (let c = 0; c < 4; c++) {
        const a = s.slice(c * 4, c * 4 + 4);
        s[c * 4] = xt(a[0]) ^ (xt(a[1]) ^ a[1]) ^ a[2] ^ a[3];
        s[c * 4 + 1] = a[0] ^ xt(a[1]) ^ (xt(a[2]) ^ a[2]) ^ a[3];
        s[c * 4 + 2] = a[0] ^ a[1] ^ xt(a[2]) ^ (xt(a[3]) ^ a[3]);
        s[c * 4 + 3] = (xt(a[0]) ^ a[0]) ^ a[1] ^ a[2] ^ xt(a[3]);
      }
    };
    add(0);
    for (let r = 1; r < rounds; r++) { sub(); shift(); mix(); add(r); }
    sub(); shift(); add(rounds);
    return s;
  }

  function decryptBlock(s, { w, rounds }) {
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
    add(rounds);
    for (let r = rounds - 1; r >= 1; r--) { invShift(); invSub(); add(r); invMix(); }
    invShift(); invSub(); add(0);
    return s;
  }

  /** ECB 해독 (16바이트 단위, 남는 꼬리는 버림) */
  function ecbDecrypt(key, data) {
    const k = expandKey(key), n = data.length - (data.length % 16), out = new Uint8Array(n);
    for (let i = 0; i < n; i += 16) out.set(decryptBlock(data.slice(i, i + 16), k), i);
    return out;
  }
  /** WinZip AES 방식 CTR: 카운터는 1부터, 16바이트 리틀엔디언. 암호화·해독이 같은 연산 */
  function ctrLE(key, data) {
    const k = expandKey(key), out = new Uint8Array(data.length), ctr = new Uint8Array(16);
    ctr[0] = 1;
    for (let i = 0; i < data.length; i += 16) {
      const ks = encryptBlock(ctr.slice(), k);
      const n = Math.min(16, data.length - i);
      for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
      for (let j = 0; j < 16; j++) { ctr[j] = (ctr[j] + 1) & 0xff; if (ctr[j]) break; }
    }
    return out;
  }
  return { expandKey, encryptBlock, decryptBlock, ecbDecrypt, ctrLE };
})();
