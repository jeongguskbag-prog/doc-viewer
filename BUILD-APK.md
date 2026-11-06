# APK 빌드 방법 (테스트용 디버그 APK)

필요 환경
- Android Studio (최신 안정 버전, SDK 36 설치 포함)
- JDK 21 (Android Studio에 포함된 JDK를 쓰면 됩니다)

빌드 순서
1. 압축을 풀고 `android` 폴더를 Android Studio로 엽니다 (File > Open).
2. Gradle 동기화가 끝날 때까지 기다립니다.
3. 메뉴에서 Build > Build Bundle(s) / APK(s) > Build APK(s)를 선택합니다.
4. 완료되면 `android/app/build/outputs/apk/debug/app-debug.apk` 가 생깁니다. (GitHub Actions 빌드는 `DocumentViewer.apk` 이름으로 Releases에 올라갑니다.)
5. 휴대폰에 옮겨 설치합니다 (설치 전 "알 수 없는 앱 설치" 허용 필요).

또는 터미널에서 `cd android && ./gradlew assembleDebug` 를 실행해도 됩니다.

참고
- 앱은 `android/app/src/main/assets/public` 에 들어 있는 뷰어 웹앱입니다. 웹앱을 고치면 `npx cap sync android` 를 다시 실행해야 APK에 반영됩니다. 이 명령은 프로젝트 루트(웹앱 폴더)에서 실행하세요.
- PDF, DOCX, 엑셀 등을 읽는 라이브러리는 CDN에서 불러오므로 APK 실행 시 인터넷 연결이 필요합니다.
- 파일 열기는 WebView의 파일 선택 기능을 씁니다. 실제 기기에서 파일 열기, 인쇄, 공유가 동작하는지 확인이 필요합니다.
- 외부 링크 열기와 인쇄는 Android WebView에서 기본 동작이 브라우저와 다를 수 있어 테스트에서 확인이 필요합니다.
- 서명되지 않은 디버그 APK이므로 스토어 출시용이 아닙니다. 출시용은 별도 서명 키가 필요합니다.
