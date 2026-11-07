// AZO 압축 해제 — 알집(ALZip) EGG 의 "고압축(AZO)" 방식.
// EggDotNet (MIT License, Copyright (c) 2026 Andrew Kolman) 의 AZO 복호기를 자바스크립트로 옮김.
// 적응형 확률 모델 + 산술 부호화 + LZ 방식 되풀이. C# 의 부호 없는 32비트 연산을 >>>0 으로 재현함.
window.AZO = (() => {
  const err = (m) => Object.assign(new Error("azo: " + m), { code: "corrupt" });
  const VERSION = 0x31, REDUCE_MIN = 8;
  const ALPHA_SIZE = 256, MATCH_MIN_LENGTH = 2, MATCH_MIN_DIST = 1;
  const DIST_SGAP = 16, DIST_GAP = 4, LEN_CODE_SIZE = 128, DIST_CODE_SIZE = 128;
  const DIST_HISTORY = 2, DICT_SIZE = 128, DICT_HISTORY = 2, ALPHA_SHIFT = 5, LEN_SHIFT = 4, N_STATE = 8;
  const LEN_TABLE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 46, 48, 50, 52, 54, 56, 58, 62, 66, 70, 74, 78,
    82, 86, 90, 98, 106, 114, 122, 130, 138, 146, 154, 170, 186, 202, 218, 234, 250, 266, 282, 314, 346, 378,
    410, 442, 474, 506, 538, 602, 666, 730, 794, 858, 922, 986, 1050, 1178, 1306, 1434, 1562, 1690, 1818, 1946,
    2074, 2330, 2586, 2842, 3098, 3354, 3610, 3866, 4122, 4634, 5146, 5658, 6170, 6682, 7194, 7706, 8218, 9242,
    10266, 11290, 12314, 13338, 14362, 15386, 16410, 18458, 20506, 22554, 24602, 26650, 28698, 30746];
  const DIST_TABLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 25, 27, 29, 33, 37, 41, 45,
    53, 61, 69, 77, 93, 109, 125, 141, 173, 205, 237, 269, 333, 397, 461, 525, 653, 781, 909, 1037, 1293, 1549,
    1805, 2061, 2573, 3085, 3597, 4109, 5133, 6157, 7181, 8205, 10253, 12301, 14349, 16397, 20493, 24589, 28685,
    32781, 40973, 49165, 57357, 65549, 81933, 98317, 114701, 131085, 163853, 196621, 229389, 262157, 327693,
    393229, 458765, 524301, 655373, 786445, 917517, 1048589, 1310733, 1572877, 1835021, 2097165, 2621453,
    3145741, 3670029, 4194317, 5242893, 6291469, 7340045, 8388621, 10485773, 12582925, 14680077, 16777229,
    20971533, 25165837, 29360141, 33554445, 41943053, 50331661, 58720269, 67108877, 83886093, 100663309,
    117440525, 134217741, 167772173, 201326605, 234881037, 268435469, 335544333, 402653197, 469762061,
    536870925, 671088653, 805306381, 939524109];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4,
    4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8,
    8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11];
  const DIST_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4,
    4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12,
    12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18,
    18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25,
    25, 25, 25, 26, 26, 26, 26, 27, 27, 27, 27];
  // C# 의 (int)(Math.Log(x)/Math.Log(2)) 와 같게 (원본 복호기와 결과가 일치하도록 같은 식 사용)
  const log2i = (x) => Math.trunc(Math.log(x) / Math.log(2));

  // ---------- 비트 읽기 ----------
  class BitCode {
    constructor(buf) { this.buf = buf; this.size = buf.length * 8; this.idx = 0; this.remain = 8; this.read = 0; }
    byte8() { // 8비트 (초기화용)
      if (this.size < this.read + 8) return 0;
      this.read += 8;
      let bits = 8, v = 0;
      if (this.remain <= bits) {
        bits -= this.remain;
        v = ((this.buf[this.idx++] & ((1 << this.remain) - 1)) << bits) & 0xff;
        this.remain = 8;
        while (bits >= 8) { bits -= 8; v |= (this.buf[this.idx++] << bits) & 0xff; }
      }
      if (bits) { this.remain -= bits; v |= (this.buf[this.idx] >>> this.remain) & ((1 << bits) - 1); }
      return v & 0xff;
    }
    bit() {
      if (this.size === this.read) return 0;
      this.read++; this.remain--;
      if (this.idx >= this.buf.length) return 0;
      const v = (this.buf[this.idx] >>> this.remain) & 1;
      if (this.remain === 0) { this.idx++; this.remain = 8; }
      return v;
    }
  }

  // ---------- 산술 복호기 ----------
  const MSB = 0x80000000, SMSB = 0x40000000;
  class Entropy {
    constructor(buf) { this.bitc = new BitCode(buf); this.low = 0; this.up = 0xffffffff; this.tag = 0; }
    init() { for (let i = 0; i < 4; i++) this.tag = (this.tag | (this.bitc.byte8() << ((3 - i) * 8))) >>> 0; }
    rescale() {
      while (((this.low & MSB) >>> 0) === ((this.up & MSB) >>> 0)) {
        this.tag = ((this.tag << 1) | this.bitc.bit()) >>> 0;
        this.low = (this.low << 1) >>> 0;
        this.up = ((this.up << 1) | 1) >>> 0;
      }
      while ((this.low & SMSB) !== 0 && (this.up & SMSB) === 0) {
        this.tag = ((this.tag << 1) | this.bitc.bit()) >>> 0;
        this.tag = (this.tag ^ MSB) >>> 0;
        this.low = ((this.low << 1) & 0x7fffffff) >>> 0;
        this.up = ((this.up << 1) | 1 | MSB) >>> 0;
      }
    }
    span(totalBit) {
      if (this.low === 0 && this.up === 0xffffffff) return ((1 << (32 - totalBit)) >>> 0) || 1; // C#: 1<<32 은 1
      return Math.floor((((this.up - this.low) >>> 0) + 1) / 2 ** totalBit);
    }
    value(totalBit) { // totalBit 비트의 값
      const t = this.span(totalBit);
      const v = Math.floor(((this.tag - this.low) >>> 0) / t);
      this.up = (this.low + t * (v + 1) - 1) >>> 0;
      this.low = (this.low + t * v) >>> 0;
      this.rescale();
      return v >>> 0;
    }
    bool(cum, totalBit) {
      const t = this.span(totalBit);
      const v = Math.floor(((this.tag - this.low) >>> 0) / t);
      const r = v >= cum;
      if (r) this.low = (this.low + t * cum) >>> 0;
      else this.up = (this.low + t * cum - 1) >>> 0;
      this.rescale();
      return r;
    }
    size() { return Math.floor((this.bitc.read + 7) / 8); }
  }

  // ---------- 확률 모델 ----------
  class BitProb {
    constructor(n) { this.bitN = log2i(n - 1) + 1; this.prob = new Uint32Array(1 << this.bitN).fill(512); }
    code(e) {
      let value = 0, pre = 1;
      for (let i = this.bitN - 1; i >= 0; i--) {
        const v = e.bool(this.prob[pre], 10);
        if (v) value |= 1 << i;
        pre = (pre << 1) | (v ? 1 : 0);
      }
      this.update(value);
      return value >>> 0;
    }
    update(value) {
      let pre = 1;
      for (let i = this.bitN - 1; i >= 0; i--) {
        const v = (value >>> i) & 1;
        const p = this.prob[pre];
        this.prob[pre] = v ? p - (p >>> 4) : p + ((1024 - p) >>> 4);
        pre = (pre << 1) | v;
      }
    }
    compare(other, value) {
      let p1 = 1, p2 = 1, pre = 1;
      for (let i = this.bitN - 1; i >= 0; i--) {
        const a = this.prob[pre], b = other.prob[pre];
        const v = (value >>> i) & 1;
        if (((p1 | p2) & 0xffc00000) !== 0) { p1 >>>= 10; p2 >>>= 10; }
        p1 = (p1 * (v ? 1024 - a : a)) >>> 0;
        p2 = (p2 * (v ? 1024 - b : b)) >>> 0;
        pre = (pre << 1) | v;
      }
      return p1 > p2 ? 1 : p1 < p2 ? -1 : 0;
    }
  }

  class BoolState {
    constructor() { this.prob = new Uint32Array(1 << N_STATE).fill(2048); this.state = 0; }
    code(e) {
      const b = e.bool(this.prob[this.state], 12);
      const p = this.prob[this.state];
      this.prob[this.state] = b ? p - (p >>> 6) : p + ((4096 - p) >>> 6);
      this.state = ((this.state << 1) & ((1 << N_STATE) - 1)) | (b ? 1 : 0);
      return b;
    }
  }

  class PredictProb {
    constructor(key, n, shift) {
      this.shift = shift;
      this.p1 = Array.from({ length: key }, () => new BitProb(n));
      this.p2 = Array.from({ length: key >> shift }, () => new BitProb(n));
      this.lucky = new Int32Array(key);
    }
    code(e, pre) {
      const a = this.p1[pre], b = this.p2[pre >>> this.shift];
      let v;
      if (this.lucky[pre] >= 0) { v = a.code(e); b.update(v); } else { v = b.code(e); a.update(v); }
      const r = a.compare(b, v);
      if (r > 0) this.lucky[pre]++; else if (r < 0) this.lucky[pre]--;
      return v;
    }
  }

  class HistoryList {
    constructor(init, n) { this.rep = Array.from({ length: n }, (_, i) => init + i); this.state = new BoolState(); this.prob = new BitProb(n); }
    add(v, del) { const d = del === undefined ? this.rep.length - 1 : del; for (let i = d; i > 0; i--) this.rep[i] = this.rep[i - 1]; this.rep[0] = v; }
    code(e) { // 찾으면 값, 아니면 null
      if (!this.state.code(e)) return null;
      const idx = this.prob.code(e);
      const v = this.rep[idx];
      this.add(v, idx);
      return v;
    }
  }

  class SymbolCode {
    constructor(n, hn) { this.history = new HistoryList(0, hn); this.prob = new BitProb(n); }
    code(e) { let r = this.history.code(e); if (r === null) { r = this.prob.code(e); this.history.add(r); } return r; }
  }

  class DictionaryTable {
    constructor() { this.data = Array.from({ length: DICT_SIZE }, (_, i) => ({ position: 0, length: MATCH_MIN_LENGTH + i })); this.find = new BoolState(); this.prob = new SymbolCode(DICT_SIZE, DICT_HISTORY); }
    code(e) {
      if (!this.find.code(e)) return null;
      const n = this.prob.code(e);
      if (n >= DICT_SIZE) return null;
      const { position, length } = this.data[n];
      this.update(position, length, n);
      return { position, length };
    }
    update(pos, len, del) {
      const d = del === undefined ? DICT_SIZE - 1 : del;
      for (let i = d; i > 0; i--) this.data[i] = this.data[i - 1];
      this.data[0] = { position: pos, length: len };
    }
  }

  function matchDistCode(value) {
    value -= MATCH_MIN_DIST;
    if (value < DIST_SGAP) return value;
    value -= DIST_SGAP;
    const extra = log2i(Math.floor(value / DIST_GAP) + 1);
    return (DIST_SGAP + extra * DIST_GAP + Math.floor((value - ((2 ** extra) - 1) * DIST_GAP) / (2 ** extra))) >>> 0;
  }

  class DistanceCode {
    constructor() { this.history = new HistoryList(MATCH_MIN_DIST, DIST_HISTORY); this.prob = new BitProb(DIST_CODE_SIZE); }
    code(e) {
      let d = this.history.code(e);
      if (d === null) {
        const idx = this.prob.code(e);
        d = DIST_TABLE[idx];
        if (idx < DIST_EXTRA.length) d += e.value(DIST_EXTRA[idx]);
        this.history.add(d);
      }
      return d;
    }
  }
  class LengthCode {
    constructor() { this.prob = new PredictProb(DIST_CODE_SIZE, LEN_CODE_SIZE, LEN_SHIFT); }
    code(e, distCode) {
      const c = this.prob.code(e, distCode);
      let len = LEN_TABLE[c];
      if (c < LEN_EXTRA.length) len += e.value(LEN_EXTRA[c]);
      return len;
    }
  }

  // 한 블록 풀기
  function decodeBlock(inp, outSize) {
    const out = new Uint8Array(outSize);
    if (inp.length + REDUCE_MIN > outSize) {
      if (inp.length === outSize) { out.set(inp); return out; }
      throw err("bad stored block");
    }
    const e = new Entropy(inp);
    e.init();
    const matchState = new BoolState(), alpha = new PredictProb(ALPHA_SIZE, ALPHA_SIZE, ALPHA_SHIFT);
    const dict = new DictionaryTable(), dist = new DistanceCode(), lenc = new LengthCode();
    out[0] = alpha.code(e, 0);
    for (let i = 1; i < outSize;) {
      if (!matchState.code(e)) { out[i] = alpha.code(e, out[i - 1]); i++; continue; }
      let d, len;
      const hit = dict.code(e);
      if (hit === null) {
        d = dist.code(e);
        len = lenc.code(e, matchDistCode(d));
        dict.update(i, len);
      } else {
        d = (i - hit.position) >>> 0; len = hit.length;
      }
      if (!(i >= d && i + len <= outSize)) throw err("bad match");
      for (let k = 0; k < len; k++) out[i + k] = out[i - d + k];
      i += len;
    }
    if (e.size() !== inp.length) throw err("size mismatch");
    return out;
  }

  /** AZO 데이터 → 풀린 바이트 (최대 outSize) */
  function decompress(src, outSize) {
    if (src.length < 2 || src[0] !== VERSION) throw err("bad header");
    let p = 2;
    const parts = [];
    let total = 0;
    const be32 = (o) => ((src[o] << 24) | (src[o + 1] << 16) | (src[o + 2] << 8) | src[o + 3]) >>> 0;
    while (p + 12 <= src.length && total < outSize) {
      const blockSize = be32(p), compSize = be32(p + 4), check = be32(p + 8);
      p += 12;
      if (blockSize < compSize || ((blockSize ^ compSize) >>> 0) !== check) throw err("block header checksum");
      if (!blockSize || !compSize) break;
      if (p + compSize > src.length) throw err("truncated");
      const block = decodeBlock(src.subarray(p, p + compSize), blockSize);
      p += compSize;
      parts.push(block); total += block.length;
    }
    const out = new Uint8Array(Math.min(total, outSize));
    let at = 0;
    for (const b of parts) { const n = Math.min(b.length, out.length - at); out.set(b.subarray(0, n), at); at += n; }
    return out;
  }
  return { decompress };
})();
