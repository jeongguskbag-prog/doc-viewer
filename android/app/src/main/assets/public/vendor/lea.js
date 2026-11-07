// LEA 블록 암호 (한국인터넷진흥원 KISA 표준, 128비트 블록, 128/192/256비트 열쇠) — 알집 EGG 의 LEA 암호 해제에 씀.
// CTR 모드(카운터는 빅엔디언으로 1씩 증가)로 해독. 외부 라이브러리 없음.
window.LEA = (() => {
  const DELTA = [0xc3efe9db, 0x44626b02, 0x79e27c8a, 0x78df30ec, 0x715ea49e, 0xc785da0a, 0xe04ef22a, 0xe5c40957];
  const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const ror = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const add = (a, b) => (a + b) >>> 0;
  const word = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; // 리틀엔디언

  /** 라운드 열쇠: [ [rk0..rk5], ... ] */
  function expandKey(key) {
    const nk = key.length / 4;
    const T = []; for (let i = 0; i < nk; i++) T.push(word(key, i * 4));
    const rk = [];
    if (nk === 4) {
      for (let i = 0; i < 24; i++) {
        const d = DELTA[i % 4];
        T[0] = rol(add(T[0], rol(d, i % 32)), 1);
        T[1] = rol(add(T[1], rol(d, (i + 1) % 32)), 3);
        T[2] = rol(add(T[2], rol(d, (i + 2) % 32)), 6);
        T[3] = rol(add(T[3], rol(d, (i + 3) % 32)), 11);
        rk.push([T[0], T[1], T[2], T[1], T[3], T[1]]);
      }
    } else if (nk === 6) {
      for (let i = 0; i < 28; i++) {
        const d = DELTA[i % 6];
        T[0] = rol(add(T[0], rol(d, i % 32)), 1);
        T[1] = rol(add(T[1], rol(d, (i + 1) % 32)), 3);
        T[2] = rol(add(T[2], rol(d, (i + 2) % 32)), 6);
        T[3] = rol(add(T[3], rol(d, (i + 3) % 32)), 11);
        T[4] = rol(add(T[4], rol(d, (i + 4) % 32)), 13);
        T[5] = rol(add(T[5], rol(d, (i + 5) % 32)), 17);
        rk.push(T.slice(0, 6));
      }
    } else if (nk === 8) {
      for (let i = 0; i < 32; i++) {
        const d = DELTA[i % 8];
        const j = (6 * i) % 8;
        T[j] = rol(add(T[j], rol(d, i % 32)), 1);
        T[(j + 1) % 8] = rol(add(T[(j + 1) % 8], rol(d, (i + 1) % 32)), 3);
        T[(j + 2) % 8] = rol(add(T[(j + 2) % 8], rol(d, (i + 2) % 32)), 6);
        T[(j + 3) % 8] = rol(add(T[(j + 3) % 8], rol(d, (i + 3) % 32)), 11);
        T[(j + 4) % 8] = rol(add(T[(j + 4) % 8], rol(d, (i + 4) % 32)), 13);
        T[(j + 5) % 8] = rol(add(T[(j + 5) % 8], rol(d, (i + 5) % 32)), 17);
        rk.push([T[j], T[(j + 1) % 8], T[(j + 2) % 8], T[(j + 3) % 8], T[(j + 4) % 8], T[(j + 5) % 8]]);
      }
    } else throw new Error("LEA key must be 16, 24 or 32 bytes");
    return rk;
  }

  /** 16바이트 블록 암호화 (in → out) */
  function encryptBlock(rk, inp, out) {
    let x0 = word(inp, 0), x1 = word(inp, 4), x2 = word(inp, 8), x3 = word(inp, 12);
    for (const k of rk) {
      const n0 = rol(add((x0 ^ k[0]) >>> 0, (x1 ^ k[1]) >>> 0), 9);
      const n1 = ror(add((x1 ^ k[2]) >>> 0, (x2 ^ k[3]) >>> 0), 5);
      const n2 = ror(add((x2 ^ k[4]) >>> 0, (x3 ^ k[5]) >>> 0), 3);
      x3 = x0; x0 = n0; x1 = n1; x2 = n2;
    }
    [x0, x1, x2, x3].forEach((w, i) => { out[i * 4] = w & 0xff; out[i * 4 + 1] = (w >>> 8) & 0xff; out[i * 4 + 2] = (w >>> 16) & 0xff; out[i * 4 + 3] = w >>> 24; });
    return out;
  }

  /** CTR 모드 (카운터 16바이트, 빅엔디언 증가). 암호화·해독이 같은 연산 */
  function ctr(key, iv, data) {
    const rk = expandKey(key);
    const c = new Uint8Array(iv), ks = new Uint8Array(16), out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 16) {
      encryptBlock(rk, c, ks);
      const n = Math.min(16, data.length - i);
      for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
      for (let j = 15; j >= 0; j--) { c[j] = (c[j] + 1) & 0xff; if (c[j]) break; }
    }
    return out;
  }
  return { expandKey, encryptBlock, ctr };
})();
