// LZMA 압축 해제 (원래 LZMA, 크기를 아는 경우) — 알집 EGG 의 LZMA 압축에 씀. 외부 라이브러리 없음.
// 공개된 LZMA 사양(범위 복호기 + 리터럴/매치/반복 상태 기계)을 그대로 따름.
window.LZMA = (() => {
  const err = (m) => Object.assign(new Error("lzma: " + m), { code: "corrupt" });
  const PROB_INIT = 1024;
  const probs = (n) => new Uint16Array(n).fill(PROB_INIT);

  /** props: 5바이트(lc/lp/pb + 사전 크기), data: 압축 데이터, outSize: 풀린 크기 */
  function decodeRaw(props, data, outSize) {
    let d = props[0];
    if (d >= 9 * 5 * 5) throw err("bad properties");
    const lc = d % 9; d = (d / 9) | 0;
    const lp = d % 5, pb = (d / 5) | 0;
    const out = new Uint8Array(outSize);
    let op = 0;

    // 범위 복호기
    let ip = 0, range = 0xffffffff, code = 0;
    const byte = () => (ip < data.length ? data[ip++] : 0);
    if (byte() !== 0) throw err("bad stream start");
    for (let i = 0; i < 4; i++) code = ((code << 8) | byte()) >>> 0;
    const norm = () => { if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | byte()) >>> 0; } };
    const bit = (p, i) => {
      const bound = ((range >>> 11) * p[i]) >>> 0;
      let b;
      if (code < bound) { range = bound; p[i] += (2048 - p[i]) >>> 5; b = 0; }
      else { range = (range - bound) >>> 0; code = (code - bound) >>> 0; p[i] -= p[i] >>> 5; b = 1; }
      norm();
      return b;
    };
    const direct = (n) => {
      let r = 0;
      while (n--) {
        range >>>= 1;
        let t = 0;
        if (code >= range) { code = (code - range) >>> 0; t = 1; }
        r = ((r << 1) | t) >>> 0;
        norm();
      }
      return r;
    };
    const tree = (p, base, nbits) => { let m = 1; for (let i = 0; i < nbits; i++) m = (m << 1) | bit(p, base + m); return m - (1 << nbits); };
    const revTree = (p, base, nbits) => { let m = 1, sym = 0; for (let i = 0; i < nbits; i++) { const b = bit(p, base + m); m = (m << 1) | b; sym |= b << i; } return sym; };

    // 확률 표
    const literal = probs(0x300 << (lc + lp));
    const isMatch = probs(12 << 4), isRep = probs(12), isRepG0 = probs(12), isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(12 << 4);
    const posSlot = probs(4 << 6), posDecoders = probs(115), align = probs(16);
    const lenDec = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
    const lenD = lenDec(), repLenD = lenDec();
    const decodeLen = (L, posState) => {
      if (!bit(L.choice, 0)) return tree(L.low, posState << 3, 3);
      if (!bit(L.choice, 1)) return 8 + tree(L.mid, posState << 3, 3);
      return 16 + tree(L.high, 0, 8);
    };

    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
    const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
    const prev = () => (op > 0 ? out[op - 1] : 0);

    while (op < outSize) {
      const posState = op & pbMask;
      if (!bit(isMatch, (state << 4) + posState)) {
        // 리터럴
        const base = 0x300 * (((op & lpMask) << lc) + (prev() >>> (8 - lc)));
        let sym = 1;
        if (state >= 7) {
          let matchByte = out[op - rep0 - 1];
          do {
            const mb = (matchByte >>> 7) & 1; matchByte <<= 1;
            const b = bit(literal, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | bit(literal, base + sym);
        out[op++] = sym & 0xff;
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (bit(isRep, state)) {
        if (op === 0) throw err("rep at start");
        if (!bit(isRepG0, state)) {
          if (!bit(isRep0Long, (state << 4) + posState)) { // 짧은 반복: 1바이트
            state = state < 7 ? 9 : 11;
            out[op] = out[op - rep0 - 1]; op++;
            continue;
          }
        } else {
          let dist;
          if (!bit(isRepG1, state)) { dist = rep1; }
          else {
            if (!bit(isRepG2, state)) { dist = rep2; } else { dist = rep3; rep3 = rep2; }
            rep2 = rep1;
          }
          rep1 = rep0; rep0 = dist;
        }
        len = decodeLen(repLenD, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = decodeLen(lenD, posState);
        state = state < 7 ? 7 : 10;
        const lenState = Math.min(len, 3);
        const slot = tree(posSlot, lenState << 6, 6);
        if (slot < 4) rep0 = slot;
        else {
          const nd = (slot >>> 1) - 1;
          let dist = ((2 | (slot & 1)) << nd) >>> 0;
          if (slot < 14) dist = (dist + revTree(posDecoders, dist - slot, nd)) >>> 0;
          else dist = (dist + ((direct(nd - 4) << 4) >>> 0) + revTree(align, 0, 4)) >>> 0;
          rep0 = dist;
        }
        if (rep0 === 0xffffffff) break; // 끝 표시
      }
      len += 2;
      if (rep0 >= op) throw err("distance out of range");
      if (op + len > outSize) len = outSize - op;
      for (let i = 0; i < len; i++) { out[op] = out[op - rep0 - 1]; op++; }
    }
    return out;
  }
  return { decodeRaw };
})();
