// bzip2 압축 해제 (표준 bzip2 형식) — 알집 EGG/ALZ 의 bzip2 압축에 씀. 외부 라이브러리 없음.
// 순서: 허프만 → MTF(앞으로 옮기기) → 역 BWT → 반복 길이 풀기. 블록마다 CRC 검사.
window.BZip2 = (() => {
  const err = (m) => Object.assign(new Error("bzip2: " + m), { code: "corrupt" });
  // bzip2 의 CRC32 (다항식 0x04C11DB7, 왼쪽부터)
  const CRC = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; CRC[i] = c >>> 0; }

  function decompress(src, maxOut) {
    let pos = 0, bitBuf = 0, bitCount = 0;
    const bits = (n) => {
      let v = 0;
      while (n > 0) {
        if (bitCount === 0) {
          if (pos >= src.length) throw err("unexpected end");
          bitBuf = src[pos++]; bitCount = 8;
        }
        const take = Math.min(n, bitCount);
        v = (v * (1 << take)) + ((bitBuf >>> (bitCount - take)) & ((1 << take) - 1));
        bitCount -= take; n -= take;
      }
      return v;
    };
    const out = [];
    let total = 0;
    const limit = maxOut || Infinity;

    while (pos < src.length) {
      // 스트림 머리 "BZh1".."BZh9" (여러 스트림이 이어질 수 있음)
      bitCount = 0;
      if (src.length - pos < 4) break;
      if (src[pos] !== 0x42 || src[pos + 1] !== 0x5a || src[pos + 2] !== 0x68) {
        if (out.length) break;
        throw err("bad header");
      }
      const level = src[pos + 3] - 0x30;
      if (level < 1 || level > 9) throw err("bad level");
      pos += 4;
      const blockMax = level * 100000;
      const tt = new Uint32Array(blockMax);

      for (;;) {
        const m1 = bits(24), m2 = bits(24);
        if (m1 === 0x177245 && m2 === 0x385090) { bits(32); break; } // 스트림 끝
        if (m1 !== 0x314159 || m2 !== 0x265359) throw err("bad block magic");
        const blockCrc = bits(32) >>> 0;
        if (bits(1)) throw err("randomised blocks not supported");
        const origPtr = bits(24);

        // 사용된 바이트 표
        const used = bits(16), seqToUnseq = [];
        for (let i = 0; i < 16; i++) {
          if (used & (0x8000 >> i)) {
            const k = bits(16);
            for (let j = 0; j < 16; j++) if (k & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
          }
        }
        const nInUse = seqToUnseq.length;
        if (!nInUse) throw err("no symbols");
        const alphaSize = nInUse + 2;
        const nGroups = bits(3);
        if (nGroups < 2 || nGroups > 6) throw err("bad groups");
        const nSelectors = bits(15);
        if (!nSelectors) throw err("bad selectors");
        const mtfGroups = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
        const selectors = new Uint8Array(nSelectors);
        for (let i = 0; i < nSelectors; i++) {
          let j = 0;
          while (bits(1)) { j++; if (j >= nGroups) throw err("bad selector"); }
          const v = mtfGroups[j]; mtfGroups.splice(j, 1); mtfGroups.unshift(v);
          selectors[i] = v;
        }
        // 그룹별 허프만 표 (정규 허프만: limit/base/perm)
        const tables = [];
        for (let g = 0; g < nGroups; g++) {
          const len = new Uint8Array(alphaSize);
          let cur = bits(5);
          for (let s = 0; s < alphaSize; s++) {
            for (;;) {
              if (cur < 1 || cur > 20) throw err("bad code length");
              if (!bits(1)) break;
              cur += bits(1) ? -1 : 1;
            }
            len[s] = cur;
          }
          let minLen = 32, maxLen = 0;
          for (const l of len) { if (l > maxLen) maxLen = l; if (l < minLen) minLen = l; }
          const perm = [], limit = new Int32Array(maxLen + 2), base = new Int32Array(maxLen + 2);
          for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < alphaSize; s++) if (len[s] === l) perm.push(s);
          const count = new Int32Array(maxLen + 2);
          for (const l of len) count[l]++;
          let code = 0, idx = 0;
          for (let l = minLen; l <= maxLen; l++) {
            base[l] = idx - code; // perm 위치 = code + base[l]
            code += count[l]; idx += count[l];
            limit[l] = code - 1;
            code <<= 1;
          }
          tables.push({ minLen, maxLen, limit, base, perm });
        }

        // 기호 풀기 + MTF + RUNA/RUNB
        const mtf = seqToUnseq.slice();
        const byteCount = new Uint32Array(256);
        let n = 0, groupPos = 0, sel = 0, tab = tables[selectors[0]], runPos = 0, runLen = 0;
        const EOB = nInUse + 1;
        for (;;) {
          if (groupPos === 0) {
            if (sel >= nSelectors) throw err("selector overflow");
            tab = tables[selectors[sel++]]; groupPos = 50;
          }
          groupPos--;
          let l = tab.minLen, code = bits(l);
          while (code > tab.limit[l]) { l++; if (l > tab.maxLen) throw err("bad code"); code = (code << 1) | bits(1); }
          const sym = tab.perm[code + tab.base[l]];
          if (sym <= 1) { // RUNA=0, RUNB=1: 앞 기호 반복
            if (runPos === 0) { runPos = 1; runLen = 0; }
            runLen += (sym + 1) * runPos; runPos <<= 1;
            if (runLen > blockMax) throw err("run too long");
            continue;
          }
          if (runPos) {
            runPos = 0;
            const b = mtf[0];
            if (n + runLen > blockMax) throw err("block overflow");
            byteCount[b] += runLen;
            while (runLen--) tt[n++] = b;
          }
          if (sym === EOB) break;
          const j = sym - 1, b = mtf[j];
          mtf.splice(j, 1); mtf.unshift(b);
          if (n >= blockMax) throw err("block overflow");
          byteCount[b]++;
          tt[n++] = b;
        }
        if (origPtr >= n) throw err("bad origPtr");

        // 역 BWT
        const cum = new Uint32Array(256);
        for (let i = 0, s = 0; i < 256; i++) { cum[i] = s; s += byteCount[i]; }
        for (let i = 0; i < n; i++) { const b = tt[i] & 0xff; tt[cum[b]++] |= i << 8; }
        // 반복 길이(4개 같은 바이트 + 횟수) 풀기
        const block = new Uint8Array(Math.min(n * 2 + 256, 1 << 30));
        let o = 0, idx = tt[origPtr] >>> 8, last = -1, run = 0, crc = 0xffffffff;
        let outBuf = block;
        const put = (b) => {
          if (o >= outBuf.length) { const nb = new Uint8Array(outBuf.length * 2); nb.set(outBuf); outBuf = nb; }
          outBuf[o++] = b; crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0;
        };
        for (let i = 0; i < n; i++) {
          const v = tt[idx]; const b = v & 0xff; idx = v >>> 8;
          if (run === 4) {
            for (let k = 0; k < b; k++) put(last);
            run = 0; last = -1; continue;
          }
          if (b === last) run++; else { run = 1; last = b; }
          put(b);
        }
        if (((~crc) >>> 0) !== blockCrc) throw err("block CRC mismatch");
        out.push(outBuf.subarray(0, o));
        total += o;
        if (total > limit) throw Object.assign(new Error("too big"), { code: "tooBig" });
        tt.fill(0, 0, n);
      }
      // 스트림 사이 정렬
      bitCount = 0;
    }
    const res = new Uint8Array(total);
    let at = 0;
    for (const c of out) { res.set(c, at); at += c.length; }
    return res;
  }
  return { decompress };
})();
