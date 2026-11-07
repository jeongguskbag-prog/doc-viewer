// 압축 파일 읽기: 7z · RAR(RAR4/RAR5)
// - libarchive.js (MIT, libarchive 를 WebAssembly 로 옮긴 것) 를 처음 쓸 때만 불러옴 (lib/libarchive/)
// - 풀기는 백그라운드 작업(Web Worker)에서 하므로 화면이 멈추지 않음
// - archive.js 와 같은 형식 { kind, entries:[{ path, dir, size, csize, encrypted, read }] } 을 돌려줌
// - 지원하지 않는 것은 미리 알려 줌: 분할 압축(.part1.rar, .7z.001), 암호 걸린 7z·RAR
window.SevenRar = (() => {
  const MAX_ENTRY = 512 * 1024 * 1024;  // 한 파일 풀린 크기 상한 (archive.js 와 같음)
  const MAX_ENTRIES = 20000;
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  const SIG_7Z = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
  const SIG_RAR = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];        // "Rar!\x1a\x07" (+ 0x00 = RAR4, 0x01 0x00 = RAR5)
  const starts = (b, sig) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

  /** 앞부분 바이트로 7z · RAR 판별 */
  function kindOf(head) {
    if (starts(head, SIG_7Z)) return "7z";
    if (starts(head, SIG_RAR)) return "rar";
    return null;
  }

  // RAR5 가변 길이 정수
  function vint(b, p) {
    let v = 0, mul = 1;
    for (let i = 0; i < 10 && p.i < b.length; i++) {
      const x = b[p.i++];
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) return v;
      mul *= 128;
    }
    return -1;
  }

  /** 분할 압축의 한 조각인지 (머리글의 "여러 볼륨" 표시 또는 파일 이름으로 판단) */
  function isVolume(head, name, kind) {
    // 확장자를 모르는 파일은 앱이 내용을 보고 .7z/.rar 를 덧붙이므로 (plain.7z.001 → plain.7z.001.7z) 그 경우도 봄
    if (kind === "7z") return /\.7z\.\d{3}(\.7z)?$/i.test(name || "");
    if (/\.(part\d+\.rar|r\d{2})(\.rar)?$/i.test(name || "")) return true;
    if (head[6] === 0x00) {
      // RAR4: 7바이트 서명 뒤 MAIN_HEAD (CRC 2, 종류 1 = 0x73, 플래그 2)
      return head[9] === 0x73 && ((head[10] | (head[11] << 8)) & 0x0001) !== 0;
    }
    if (head[6] === 0x01 && head[7] === 0x00) {
      // RAR5: 8바이트 서명 뒤 CRC32(4), 머리글 크기, 종류(1 = 주 머리글), 머리글 플래그, [추가 영역 크기], 압축 플래그
      const p = { i: 12 };
      if (vint(head, p) < 0) return false;
      if (vint(head, p) !== 1) return false;
      const hflags = vint(head, p);
      if (hflags < 0) return false;
      if (hflags & 0x0001) vint(head, p);
      if (hflags & 0x0002) vint(head, p);
      const aflags = vint(head, p);
      return aflags >= 0 && (aflags & 0x0001) !== 0;
    }
    return false;
  }

  let lib = null;     // libarchive.js 모듈 (한 번만 불러옴)
  let current = null; // 지금 열려 있는 압축 (다른 압축을 열면 닫아서 메모리 정리)

  function load() {
    if (!lib) {
      const url = new URL("lib/libarchive/libarchive.js", document.baseURI).href;
      lib = import(url).catch((e) => { lib = null; throw err("engine", e && e.message); });
    }
    return lib;
  }

  function mapError(e) {
    if (e && e.code) return e;
    const msg = (e && e.message) || String(e);
    if (/encrypt|passphrase|password/i.test(msg)) return err("encUnsupported", msg);
    if (/truncated|unexpected end/i.test(msg)) return err("corrupt", msg);
    return err("corrupt", msg);
  }

  /** file(File) 과 앞부분 바이트 → { kind, entries } */
  async function open(file, head) {
    const kind = kindOf(head);
    if (!kind) throw err("notArchive");
    if (isVolume(head, file.name, kind)) throw err("splitMulti");
    const { Archive } = await load();
    if (current) { try { await current.close(); } catch { /* 이미 닫힘 */ } current = null; }
    let arc, list;
    try {
      arc = await Archive.open(file);
      current = arc;
      list = await arc.getFilesArray();
    } catch (e) { throw mapError(e); }
    // 파일 이름까지 암호화된 압축은 목록이 비어 보임
    if (!list.length) {
      let enc = null;
      try { enc = await arc.hasEncryptedData(); } catch { /* 판별 실패 */ }
      if (enc) throw err("encUnsupported");
    }
    if (list.length > MAX_ENTRIES) throw err("tooMany");
    const entries = list.map(({ file: cf, path }) => {
      const size = cf.size || 0;
      return {
        path: (path || "") + cf.name,
        dir: false,
        size,
        csize: size,
        encrypted: false,
        read: async () => {
          if (size > MAX_ENTRY) throw err("tooBig");
          if (current !== arc) throw err("corrupt", "archive closed");
          let out;
          try { out = await cf.extract(); } catch (e) { throw mapError(e); }
          return new Uint8Array(await out.arrayBuffer());
        },
      };
    });
    return { kind, entries };
  }

  return { kindOf, isVolume, open };
})();
