// 배포판 설정 파일(config.js) 생성. 사용: node scripts/write-config.js [standard|airgap]
const fs = require("fs");
const path = require("path");
const edition = process.argv[2] || "standard";
if (!["standard", "airgap"].includes(edition)) { console.error("edition must be standard or airgap"); process.exit(1); }
const airgap = edition === "airgap";
const file = path.join(__dirname, "..", "android/app/src/main/assets/public/config.js");
fs.writeFileSync(file,
  "// 배포판 설정. scripts/write-config.js 가 빌드할 때 덮어씀 (기관용 망분리 빌드: airgap/airgapLocked = true)\n" +
  `window.APP_CONFIG = { edition: "${edition}", airgap: ${airgap}, airgapLocked: ${airgap} };\n`);
console.log("config.js:", edition);
