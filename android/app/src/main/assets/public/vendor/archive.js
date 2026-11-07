// 압축 파일 읽기: ZIP · TAR · GZ(.gz/.tgz/.tar.gz) · 알집 ALZ/EGG(vendor/alzegg.js)
// - ZIP 은 중앙 디렉터리만 읽어 목록을 만들고, 파일은 열 때 하나씩 풂 (큰 압축 파일도 빠름)
// - 윈도우에서 만든 ZIP 의 한글 파일 이름(CP949) 을 바르게 표시
// - 암호 ZIP: 전통 방식(ZipCrypto)과 WinZip AES(128/192/256) — 암호 확인값·인증 코드 검사
// - 안전장치: 풀린 크기 상한, 항목 수 상한, 경로 정리(../ 제거)
// 압축 해제: fflate (MIT), AES: vendor/aes.js, PBKDF2/HMAC: 브라우저 WebCrypto
window.ArchiveReader = (() => {
  const MAX_ENTRY = 512 * 1024 * 1024;  // 한 파일 풀린 크기 상한
  const MAX_ENTRIES = 20000;

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  /** 저장할 때 쓸 안전한 상대 경로 ("../", 절대 경로, 드라이브 문자, 금지 문자 제거) */
  function safePath(p) {
    return p.replace(/\\/g, "/").split("/")
      .filter((s) => s && s !== "." && s !== "..")
      .map((s) => s.replace(/[:*?"<>|\x00-\x1f]/g, "_").slice(0, 120))
      .join("/");
  }

  function decodeName(bytes, utf8) {
    if (utf8) return new TextDecoder("utf-8").decode(bytes);
    // 플래그가 없어도 실제로는 UTF-8 인 경우가 많음 (맥·리눅스) → 먼저 엄격한 UTF-8 로 시도
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* 계속 */ }
    try { return new TextDecoder("euc-kr").decode(bytes); } catch { /* 계속 */ } // CP949 (윈도우 한국어)
    return Array.from(bytes, (c) => String.fromCharCode(c)).join("");
  }

  // ---------- ZIP ----------
  function readZip(buf) {
    const b = buf;
    // 끝에서 중앙 디렉터리 끝 레코드(EOCD) 찾기
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw err("corrupt", "end of central directory not found");
    let count = u16(b, eocd + 10), cdOff = u32(b, eocd + 16);
    // Zip64
    if (count === 0xffff || cdOff === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && u32(b, loc) === 0x07064b50) {
        const z64 = u64(b, loc + 8);
        if (u32(b, z64) === 0x06064b50) { count = u64(b, z64 + 32); cdOff = u64(b, z64 + 48); }
      }
    }
    if (count > MAX_ENTRIES) throw err("tooMany");
    const entries = [];
    let p = cdOff;
    for (let n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) throw err("corrupt", "bad central directory");
      const flags = u16(b, p + 8), method = u16(b, p + 10), dosTime = u16(b, p + 12), crc = u32(b, p + 16);
      let csize = u32(b, p + 20), size = u32(b, p + 24);
      const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
      let local = u32(b, p + 42);
      const nameBytes = b.subarray(p + 46, p + 46 + nameLen);
      const extra = b.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      let name = decodeName(nameBytes, !!(flags & 0x800));
      let aes = null;
      for (let e = 0; e + 4 <= extra.length;) {
        const id = u16(extra, e), len = u16(extra, e + 2), d = extra.subarray(e + 4, e + 4 + len);
        if (id === 0x0001) { // Zip64 크기·위치
          let q = 0;
          if (size === 0xffffffff) { size = u64(d, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(d, q); q += 8; }
          if (local === 0xffffffff) { local = u64(d, q); q += 8; }
        } else if (id === 0x7075 && len >= 5) { // 유니코드 경로 (Info-ZIP)
          name = new TextDecoder("utf-8").decode(d.subarray(5));
        } else if (id === 0x9901 && len >= 7) { // WinZip AES
          aes = { version: u16(d, 0), strength: d[4], method: u16(d, 5) };
        }
        e += 4 + len;
      }
      p += 46 + nameLen + extraLen + commentLen;
      const dir = name.endsWith("/") || name.endsWith("\\");
      entries.push({
        path: name.replace(/\\/g, "/"), dir, size, csize, method, flags, crc, dosTime,
        encrypted: !!(flags & 1), aes,
        read: (password) => readZipEntry(b, { local, csize, size, method, flags, crc, dosTime, aes }, password),
      });
    }
    return entries;
  }

  async function readZipEntry(b, e, password) {
    if (e.size > MAX_ENTRY) throw err("tooBig");
    const lp = e.local;
    if (u32(b, lp) !== 0x04034b50) throw err("corrupt", "bad local header");
    const start = lp + 30 + u16(b, lp + 26) + u16(b, lp + 28);
    let data = b.subarray(start, start + e.csize);
    let method = e.method;
    if (e.flags & 1) {
      if (password == null) throw err("needPassword");
      const pw = new TextEncoder().encode(password);
      if (e.aes) { data = await aesDecrypt(data, pw, e.aes.strength); method = e.aes.method; }
      else data = zipCryptoDecrypt(data, pw, e);
    }
    let out;
    if (method === 0) out = data.slice();
    else if (method === 8) out = fflate.inflateSync(data, { out: new Uint8Array(e.size) });
    else throw err("method", "compression method " + method);
    if (out.length > MAX_ENTRY) throw err("tooBig");
    if (!e.aes && e.crc && crc32(out) !== e.crc) throw err(e.flags & 1 ? "badPassword" : "corrupt", "crc mismatch");
    return out;
  }

  // 전통 ZIP 암호(ZipCrypto)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zipCryptoDecrypt(data, pw, e) {
    let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
    const upd = (c) => {
      k0 = (CRC[(k0 ^ c) & 0xff] ^ (k0 >>> 8)) >>> 0;
      k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
      k2 = (CRC[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8)) >>> 0;
    };
    for (const c of pw) upd(c);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const t = (k2 | 2) & 0xffff;
      const c = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
      out[i] = c; upd(c);
    }
    // 12바이트 머리의 마지막 바이트로 암호 확인 (CRC 또는 수정 시각의 상위 바이트)
    const check = out[11], want = e.flags & 8 ? (e.dosTime >>> 8) & 0xff : (e.crc >>> 24) & 0xff;
    if (check !== want) throw err("badPassword");
    return out.subarray(12);
  }

  // WinZip AES: [솔트][암호 확인 2바이트][암호문][인증 코드 10바이트]
  async function aesDecrypt(data, pw, strength) {
    const keyLen = { 1: 16, 2: 24, 3: 32 }[strength];
    if (!keyLen) throw err("method", "aes strength " + strength);
    const saltLen = keyLen / 2;
    const salt = data.subarray(0, saltLen), verifier = data.subarray(saltLen, saltLen + 2);
    const body = data.subarray(saltLen + 2, data.length - 10), mac = data.subarray(data.length - 10);
    const base = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-1" }, base, (keyLen * 2 + 2) * 8));
    const encKey = bits.subarray(0, keyLen), macKey = bits.subarray(keyLen, keyLen * 2), pv = bits.subarray(keyLen * 2);
    if (pv[0] !== verifier[0] || pv[1] !== verifier[1]) throw err("badPassword");
    const hk = await crypto.subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hk, body));
    for (let i = 0; i < 10; i++) if (sig[i] !== mac[i]) throw err("corrupt", "aes authentication failed");
    return AES.ctrLE(encKey, body);
  }

  // ---------- TAR ----------
  function readTar(b) {
    const entries = [];
    let p = 0, longName = null, paxPath = null;
    const str = (o, n) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return decodeName(z < 0 ? s : s.subarray(0, z), false); };
    const oct = (o, n) => {
      if (b[o] & 0x80) { let v = 0; for (let i = 1; i < n; i++) v = v * 256 + b[o + i]; return v; } // base-256
      return parseInt(str(o, n).trim() || "0", 8) || 0;
    };
    while (p + 512 <= b.length) {
      if (b.subarray(p, p + 512).every((x) => x === 0)) break;
      let name = str(p, 100);
      const size = oct(p + 124, 12), type = String.fromCharCode(b[p + 156] || 48);
      const prefix = str(p + 345, 155);
      if (prefix && b[p + 257] === 0x75) name = prefix + "/" + name; // ustar
      const dataAt = p + 512;
      p = dataAt + Math.ceil(size / 512) * 512;
      if (type === "L") { longName = str(dataAt, size); continue; }
      if (type === "x") {
        const txt = new TextDecoder().decode(b.subarray(dataAt, dataAt + size));
        const m = txt.match(/\d+ path=([^\n]*)\n/); if (m) paxPath = m[1];
        continue;
      }
      if (type === "g") continue;
      if (paxPath) { name = paxPath; paxPath = null; } else if (longName) { name = longName; longName = null; }
      name = name.replace(/^(\.\/)+/, "");
      if (!name || name === ".") continue;
      if (entries.length >= MAX_ENTRIES) throw err("tooMany");
      const dir = type === "5" || name.endsWith("/");
      if (!dir && type !== "0" && type !== "\0" && type !== "7") continue; // 링크 등은 건너뜀
      entries.push({ path: name, dir, size, csize: size, encrypted: false, read: async () => b.slice(dataAt, dataAt + size) });
    }
    return entries;
  }
  const isTar = (b) => b.length > 262 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72; // "ustar"

  // ---------- 진입점 ----------
  function kindOf(b, name) {
    if (b[0] === 0x50 && b[1] === 0x4b) return "zip";
    if (b[0] === 0x1f && b[1] === 0x8b) return "gz";
    if (isTar(b) || /\.tar$/i.test(name)) return "tar";
    return null;
  }

  /** bytes(Uint8Array) 와 파일 이름 → { kind, entries } */
  function open(bytes, name) {
    // 알집 ALZ · EGG 는 vendor/alzegg.js 가 처리
    if (window.AlzEgg && (AlzEgg.isEgg(bytes) || AlzEgg.isAlz(bytes))) return AlzEgg.open(bytes);
    const kind = kindOf(bytes, name || "");
    if (kind === "zip") return { kind, entries: readZip(bytes) };
    if (kind === "tar") return { kind, entries: readTar(bytes) };
    if (kind === "gz") {
      // 풀린 크기는 gzip 끝 4바이트(ISIZE, 4GB 미만)로 미리 확인
      const isize = u32(bytes, bytes.length - 4);
      if (isize > MAX_ENTRY) throw err("tooBig");
      const out = fflate.gunzipSync(bytes);
      if (isTar(out)) return { kind: "tgz", entries: readTar(out) };
      const inner = (name || "file.gz").replace(/\.(gz|tgz)$/i, (m) => (m.toLowerCase() === ".tgz" ? ".tar" : "")) || "file";
      return { kind, entries: [{ path: inner.split("/").pop(), dir: false, size: out.length, csize: bytes.length, encrypted: false, read: async () => out }] };
    }
    throw err("notArchive");
  }

  return { open, safePath, crc32 };
})();
