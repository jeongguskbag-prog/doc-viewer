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
  "html2canvas.min.js": "html2canvas/dist/html2canvas.min.js", // PDF 바로 만들기: 화면 → 그림
  "hwp-convert.mjs": "hwp-convert/dist/browser/hwp-convert.browser.mjs", // HWPX 읽기 · HWPX 내보내기
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
