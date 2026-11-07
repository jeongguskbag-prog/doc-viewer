// 문서 읽기 라이브러리를 node_modules 에서 앱 안(assets/public/lib)으로 복사한다.
// 앱이 인터넷 없이도 PDF·DOCX·XLSX·MD 를 열 수 있도록 하기 위함. `npm install` 뒤 자동 실행됨.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const nm = (p) => path.join(root, "node_modules", p);
const dest = path.join(root, "android/app/src/main/assets/public/lib");

const files = {
  "pdfjs/pdf.min.js": "pdfjs-dist/build/pdf.min.js",
  "pdfjs/pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js",
  "mammoth.browser.min.js": "mammoth/mammoth.browser.min.js",
  "xlsx.full.min.js": "xlsx/dist/xlsx.full.min.js",
  "marked.min.js": "marked/marked.min.js",
  "purify.min.js": "dompurify/dist/purify.min.js",
  "fflate.min.js": "fflate/umd/index.js", // 압축 파일(ZIP·GZ) 풀기
  "html2canvas.min.js": "html2canvas/dist/html2canvas.min.js", // PDF 바로 만들기: 화면 → 그림
  "hwp-convert.mjs": "hwp-convert/dist/browser/hwp-convert.browser.mjs", // HWPX 읽기 · HWPX 내보내기
  // 7z · RAR 풀기 (libarchive WebAssembly). 세 파일이 같은 폴더에 있어야 함 (모듈이 옆의 worker·wasm 을 찾음)
  "libarchive/libarchive.js": "libarchive.js/dist/libarchive.js",
  "libarchive/worker-bundle.js": "libarchive.js/dist/worker-bundle.js",
  "libarchive/libarchive.wasm": "libarchive.js/dist/libarchive.wasm",
};
const dirs = {
  "pdfjs/cmaps": "pdfjs-dist/cmaps", // 한글·한자·일본어 PDF 글꼴 정보
  "pdfjs/standard_fonts": "pdfjs-dist/standard_fonts",
};

fs.rmSync(dest, { recursive: true, force: true });
let missing = [];
for (const [to, from] of Object.entries(files)) {
  if (!fs.existsSync(nm(from))) { missing.push(from); continue; }
  fs.mkdirSync(path.dirname(path.join(dest, to)), { recursive: true });
  fs.copyFileSync(nm(from), path.join(dest, to));
}
for (const [to, from] of Object.entries(dirs)) {
  if (!fs.existsSync(nm(from))) { missing.push(from); continue; }
  fs.cpSync(nm(from), path.join(dest, to), { recursive: true });
}
if (missing.length) {
  console.error("vendor-libs: missing " + missing.join(", ") + " (run npm install)");
  process.exit(1);
}
console.log("vendor-libs: copied to " + path.relative(root, dest));

// ---------- 오픈소스 라이선스 고지 (lib/licenses.json) ----------
// node_modules 의 각 패키지에서 버전·라이선스·원문(LICENSE, NOTICE)을 그대로 모으고,
// 묶음 파일 안의 구성 요소 등 npm 에 없는 것은 scripts/licenses-static.json 에서 더함. 앱의 "앱 정보 · 라이선스" 화면이 읽음.
const NPM_COMPONENTS = [
  ["pdfjs-dist", "pdf", "lib/pdfjs/"],
  ["mammoth", "docx", "lib/mammoth.browser.min.js"],
  ["xlsx", "sheet", "lib/xlsx.full.min.js"],
  ["marked", "markdown", "lib/marked.min.js"],
  ["dompurify", "sanitize", "lib/purify.min.js"],
  ["hwp-convert", "hwp", "lib/hwp-convert.mjs, vendor/hwp-bridge.js"],
  ["html2canvas", "pdfExport", "lib/html2canvas.min.js"],
  ["fflate", "zip", "lib/fflate.min.js"],
  ["libarchive.js", "sevenRar", "lib/libarchive/"],
  ["@capacitor/core", "android", "Android app"],
  ["@capacitor/android", "android", "Android app"],
];
function readLicenseFiles(dir) {
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f))
    .sort((a, b) => (/notice/i.test(a) ? 1 : 0) - (/notice/i.test(b) ? 1 : 0))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim())
    .join("\n\n----\n\n");
}
const licenseComponents = NPM_COMPONENTS.map(([pkg, purpose, where]) => {
  const dir = nm(pkg);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { /* 없음 */ }
  const lic = typeof meta.license === "string" ? meta.license : (meta.license && meta.license.type) || "";
  return { name: pkg, version: meta.version || "", license: lic, purpose, where, text: readLicenseFiles(dir) || lic };
});
const staticPart = JSON.parse(fs.readFileSync(path.join(__dirname, "licenses-static.json"), "utf8"));
fs.writeFileSync(path.join(dest, "licenses.json"),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), components: licenseComponents.concat(staticPart.components) }));
console.log("vendor-libs: licenses.json (" + (licenseComponents.length + staticPart.components.length) + " components)");
