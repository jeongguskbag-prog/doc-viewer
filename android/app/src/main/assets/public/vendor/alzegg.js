// 알집(ALZip) 압축 파일 읽기: ALZ · EGG
// 형식 정보: 이스트소프트 EGG 형식 명세, EggDotNet (MIT, Andrew Kolman), XADMaster 의 ALZ 해석을 참고해 새로 작성.
// - 압축: 무압축, Deflate(fflate), Bzip2(vendor/bzip2.js), LZMA(vendor/lzma.js), AZO(vendor/azo.js)
// - 암호(EGG): ZIP 전통 방식, AES-128/256(vendor/aes.js), LEA-128/256(vendor/lea.js)  ·  암호(ALZ): ZIP 전통 방식
// - 솔리드 압축(EGG), 한글·일본어 파일 이름(코드 페이지 949/932 등)
// - 분할 압축(.vol1.egg, .a00 …)은 나머지 조각이 필요해 지원하지 않음
// 결과 형식은 vendor/archive.js 와 같음: { kind, entries: [{ path, dir, size, csize, encrypted, read(password) }] }
window.AlzEgg = (() => {
  const MAX_ENTRY = 512 * 1024 * 1024;
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const i64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  const EGG = { MAGIC: 0x41474745, END: 0x08e28222, FILE: 0x0a8590e3, NAME: 0x0a8591ac, BLOCK: 0x02b50c13, WIN: 0x2c86950b,
    POSIX: 0x1ee922e5, ENCRYPT: 0x08d1470f, COMMENT: 0x04c63672, DUMMY: 0x07463307, SPLIT: 0x24f5a262, SOLID: 0x24e5a060 };

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  function decodeText(bytes, codepage) {
    const enc = { 949: "euc-kr", 51949: "euc-kr", 932: "shift_jis", 936: "gbk", 950: "big5", 1252: "windows-1252", 65001: "utf-8" }[codepage];
    if (enc) { try { return new TextDecoder(enc).decode(bytes); } catch { /* 아래로 */ } }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* 아래로 */ }
    return new TextDecoder("euc-kr").decode(bytes);
  }

  // ---------- 압축 해제 ----------
  function inflate(method, data, size) {
    if (size > MAX_ENTRY) throw err("tooBig");
    switch (method) {
      case "store": return data.slice(0, size || data.length);
      case "deflate": return fflate.inflateSync(data, { out: new Uint8Array(size) });
      case "bzip2": return BZip2.decompress(data, size);
      case "lzma": // 앞 4바이트(머리) + 5바이트 설정 + LZMA 데이터
        if (data.length < 9) throw err("corrupt", "lzma header");
        return LZMA.decodeRaw(data.subarray(4, 9), data.subarray(9), size);
      case "azo": return AZO.decompress(data, size);
      default: throw err("method", "compression method " + method);
    }
  }
  const EGG_METHOD = { 0: "store", 1: "deflate", 2: "bzip2", 3: "azo", 4: "lzma" };
  const ALZ_METHOD = { 0: "store", 1: "bzip2", 2: "deflate" }; // 3 = 변형 Deflate (미지원)

  // ---------- 암호 ----------
  function zipCrypto(data, password, header12, checkByte) {
    let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
    const upd = (c) => {
      k0 = (CRC[(k0 ^ c) & 0xff] ^ (k0 >>> 8)) >>> 0;
      k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
      k2 = (CRC[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8)) >>> 0;
    };
    const dec = (b) => { const t = (k2 | 2) & 0xffff; const c = b ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff); upd(c); return c; };
    for (const c of new TextEncoder().encode(password)) upd(c);
    let last = 0;
    for (const b of header12) last = dec(b);
    if (last !== checkByte) throw err("badPassword");
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = dec(data[i]);
    return out;
  }

  async function pbkdf2(password, salt, bytes) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-1" }, base, bytes * 8));
  }
  async function hmac10(key, data) {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, data)).subarray(0, 10);
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // EGG 암호 머리: [방식][…]
  function parseEncrypt(d) {
    const m = d[0];
    if (m === 0) return { method: "zip", header: d.subarray(1, 13), check: d.subarray(13, 17) };
    if (m === 1 || m === 5) return { method: m === 1 ? "aes" : "lea", keyLen: 16, header: d.subarray(1, 11), mac: d.subarray(11, 21) };
    if (m === 2 || m === 6) return { method: m === 2 ? "aes" : "lea", keyLen: 32, header: d.subarray(1, 19), mac: d.subarray(19, 29) };
    return { method: "unknown" };
  }

  async function eggDecrypt(enc, data, password) {
    if (password == null) throw err("needPassword");
    if (enc.method === "zip") return zipCrypto(data, password, enc.header, enc.check[3]);
    if (enc.method === "aes" || enc.method === "lea") {
      const saltLen = enc.keyLen === 32 ? 16 : 8;
      const salt = enc.header.subarray(0, saltLen), pv = enc.header.subarray(saltLen, saltLen + 2);
      const dk = await pbkdf2(password, salt, enc.keyLen * 2 + 2);
      const key = dk.subarray(0, enc.keyLen), macKey = dk.subarray(enc.keyLen, enc.keyLen * 2), gpv = dk.subarray(enc.keyLen * 2);
      if (!same(pv, gpv)) throw err("badPassword");
      if (!same(await hmac10(macKey, data), enc.mac)) throw err("corrupt", "authentication failed");
      return enc.method === "aes" ? AES.ctrLE(key, data) : LEA.ctr(key, new Uint8Array(16), data);
    }
    throw err("method", "encryption");
  }

  // ---------- EGG ----------
  function readEgg(b) {
    let p = 4;
    p += 2 + 4 + 4; // 버전, 머리 ID, 예약
    let solid = false, split = false;
    while (p + 4 <= b.length) {
      const m = u32(b, p); p += 4;
      if (m === EGG.END) break;
      if (m === EGG.SPLIT) { split = u32(b, p + 3) !== 0 || u32(b, p + 7) !== 0; p += 11; }
      else if (m === EGG.SOLID) { solid = true; p += 3; }
      else { p -= 4; break; }
    }
    if (split) throw err("split");

    const entries = [];
    let cur = null, comment = "", globalEnc = null;
    const blocks = []; // 솔리드용
    const readBlocks = (into) => {
      while (p + 4 <= b.length && u32(b, p) === EGG.BLOCK) {
        const method = b[p + 4];
        const usize = u32(b, p + 6), csize = u32(b, p + 10), crc = u32(b, p + 14);
        const data = p + 4 + 18;
        if (data + csize > b.length) throw err("corrupt", "truncated block");
        into.push({ method: EGG_METHOD[method] || "m" + method, usize, csize, crc, data });
        p = data + csize;
      }
    };
    while (p + 4 <= b.length) {
      const m = u32(b, p); p += 4;
      if (m === EGG.FILE) {
        cur = { id: u32(b, p), size: i64(b, p + 4), path: "", dir: false, enc: globalEnc, blocks: [] };
        p += 12;
        entries.push(cur);
      } else if (m === EGG.NAME) {
        const flags = b[p], len = u16(b, p + 1); p += 3;
        let cp = 0;
        if (flags & 8) { cp = u16(b, p); p += 2; }
        if (flags & 16) p += 4;
        if (flags & 4) throw err("method", "encrypted file names");
        if (cur) cur.path = decodeText(b.subarray(p, p + len), cp || 65001);
        p += len;
      } else if (m === EGG.WIN) {
        if (cur && (b[p + 11] & 0x10)) cur.dir = true;
        p += 12;
      } else if (m === EGG.POSIX) {
        if (cur && ((u32(b, p + 3) & 0o170000) === 0o040000)) cur.dir = true;
        p += 23;
      } else if (m === EGG.ENCRYPT) {
        const size = u16(b, p + 1);
        const e = parseEncrypt(b.subarray(p + 3, p + 3 + size));
        if (cur) cur.enc = e; else globalEnc = e;
        p += 3 + size;
      } else if (m === EGG.COMMENT) {
        const size = u16(b, p + 1);
        if (!cur) comment = new TextDecoder().decode(b.subarray(p + 3, p + 3 + size));
        p += 3 + size;
      } else if (m === EGG.DUMMY) {
        p += 3 + u16(b, p + 1);
      } else if (m === EGG.END) {
        // 한 파일의 머리 끝 → 이어서 데이터 블록 (솔리드면 모든 머리 뒤에 한꺼번에)
        if (cur && !solid && cur.size > 0) readBlocks(cur.blocks);
        if (!cur && solid) { /* 머리 앞의 끝 표시 */ }
      } else if (m === EGG.BLOCK) {
        p -= 4;
        readBlocks(solid ? blocks : (cur ? cur.blocks : []));
      } else {
        break; // 알 수 없는 구조 → 여기까지
      }
    }
    if (entries.length > 20000) throw err("tooMany");

    // 블록들을 풀어 이어 붙임 (CRC 확인)
    const decodeBlocks = async (list, enc, password) => {
      const parts = [];
      let total = 0;
      for (const blk of list) {
        if (blk.usize > MAX_ENTRY) throw err("tooBig");
        let data = b.subarray(blk.data, blk.data + blk.csize);
        if (enc) data = await eggDecrypt(enc, data, password);
        const out = inflate(blk.method, data, blk.usize);
        if (blk.crc && crc32(out) !== blk.crc) throw err(enc && enc.method === "zip" ? "badPassword" : "corrupt", "crc mismatch");
        parts.push(out); total += out.length;
      }
      const res = new Uint8Array(total); let at = 0;
      for (const x of parts) { res.set(x, at); at += x.length; }
      return res;
    };

    let solidCache = null;
    const files = entries.filter((e) => e.path).map((e, idx, arr) => ({
      path: e.path.replace(/\\/g, "/"),
      dir: e.dir || /[\\/]$/.test(e.path),
      size: e.size,
      csize: e.blocks.reduce((s, x) => s + x.csize, 0),
      encrypted: !!(e.enc || (solid && (globalEnc || (entries[0] && entries[0].enc)))),
      read: async (password) => {
        if (e.size > MAX_ENTRY) throw err("tooBig");
        if (!solid) return e.size ? decodeBlocks(e.blocks, e.enc, password) : new Uint8Array(0);
        // 솔리드: 전체를 한 번 풀어 두고 파일 순서대로 잘라 씀
        if (!solidCache) solidCache = await decodeBlocks(blocks, globalEnc || (entries[0] && entries[0].enc), password);
        let off = 0;
        for (let i = 0; i < idx; i++) off += arr[i].size;
        return solidCache.slice(off, off + e.size);
      },
    }));
    return { kind: "egg", entries: files, comment };
  }

  // ---------- ALZ ----------
  function readAlz(b) {
    let p = 8;
    const entries = [];
    while (p + 4 <= b.length) {
      const sig = u32(b, p); p += 4;
      if (sig === 0x015a4c43 || sig === 0x025a4c43 || sig === 0x015a4c45) break; // CLZ, 끝/주석
      if (sig !== 0x015a4c42) { if (entries.length) break; throw err("corrupt", "bad ALZ entry"); } // BLZ
      const nameLen = u16(b, p), attr = b[p + 2], flags = b[p + 7];
      p += 9;
      const sizeBytes = (flags & 0xf0) >> 4;
      let method = 0, crc = 0, csize = 0, size = 0;
      if (sizeBytes) {
        if (![1, 2, 4, 8].includes(sizeBytes)) throw err("corrupt", "size field");
        method = b[p]; crc = u32(b, p + 2);
        const rd = (o) => (sizeBytes === 1 ? b[o] : sizeBytes === 2 ? u16(b, o) : sizeBytes === 4 ? u32(b, o) : i64(b, o));
        csize = rd(p + 6); size = rd(p + 6 + sizeBytes);
        p += 6 + sizeBytes * 2;
      }
      const name = decodeText(b.subarray(p, p + nameLen), 0);
      p += nameLen;
      const dataAt = p;
      p += csize;
      if (p > b.length) throw err("corrupt", "truncated");
      if (entries.length >= 20000) throw err("tooMany");
      const encrypted = !!(flags & 1);
      entries.push({
        path: name.replace(/\\/g, "/"), dir: !!(attr & 0x10) || /[\\/]$/.test(name), size, csize, encrypted,
        read: async (password) => {
          if (size > MAX_ENTRY) throw err("tooBig");
          let data = b.subarray(dataAt, dataAt + csize);
          if (encrypted) {
            if (password == null) throw err("needPassword");
            data = zipCrypto(data.subarray(12), password, data.subarray(0, 12), (crc >>> 24) & 0xff);
          }
          const m = ALZ_METHOD[method];
          if (!m) throw err("method", "ALZ method " + method);
          const out = size ? inflate(m, data, size) : new Uint8Array(0);
          if (crc && crc32(out) !== crc) throw err(encrypted ? "badPassword" : "corrupt", "crc mismatch");
          return out;
        },
      });
    }
    return { kind: "alz", entries };
  }

  const isAlz = (b) => b.length > 8 && b[0] === 0x41 && b[1] === 0x4c && b[2] === 0x5a && b[3] === 0x01;
  const isEgg = (b) => b.length > 14 && u32(b, 0) === EGG.MAGIC;
  function open(bytes) {
    if (isEgg(bytes)) return readEgg(bytes);
    if (isAlz(bytes)) return readAlz(bytes);
    throw err("notArchive");
  }
  return { open, isAlz, isEgg, crc32 };
})();
