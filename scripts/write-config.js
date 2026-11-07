// 배포판 설정 파일(config.js) 생성. 사용: node scripts/write-config.js [standard|airgap]
const fs = require("fs");
const path = require("path");
const edition = process.argv[2] || "standard";
if (!["standard", "airgap"].includes(edition)) { console.error("edition must be standard or airgap"); process.exit(1); }
const airgap = edition === "airgap";
const file = path.join(__dirname, "..", "android/app/src/main/assets/public/config.js");
// 앱 버전: android/app/build.gradle 의 versionName (앱 정보 화면에 표시)
const gradle = fs.readFileSync(path.join(__dirname, "..", "android/app/build.gradle"), "utf8");
const version = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
fs.writeFileSync(file,
  "// 배포판 설정. scripts/write-config.js 가 빌드할 때 덮어씀 (기관용 망분리 빌드: airgap/airgapLocked = true)\n" +
  `window.APP_CONFIG = { edition: "${edition}", version: "${version}", airgap: ${airgap}, airgapLocked: ${airgap} };\n`);
console.log("config.js:", edition);
