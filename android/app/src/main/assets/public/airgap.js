// 망분리(보안) 모드: 켜져 있으면 앱이 외부 서버와 통신하지 못하게 막는다.
//  1) 브라우저 보안 정책(CSP): 같은 앱 안의 파일 외에는 연결·이미지·글꼴 불러오기를 금지
//  2) fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon 을 감싸 외부 주소 요청을 거부
// 다른 스크립트보다 먼저 <head> 에서 실행되어야 한다.
(function () {
  var cfg = window.APP_CONFIG || {};
  var on = !!(cfg.airgapLocked || cfg.airgap);
  if (!cfg.airgapLocked) {
    try {
      var saved = localStorage.getItem("viewer.airgap");
      if (saved === "1") on = true;
      else if (saved === "0") on = false;
    } catch (e) { /* 저장소를 못 쓰면 배포판 기본값 */ }
  }
  window.AIRGAP = { on: on, locked: !!cfg.airgapLocked, blocked: 0 };
  if (!on) return;

  var meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = [
    "default-src 'self' blob: data:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' blob: data:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data: about:",
    "form-action 'none'",
  ].join("; ");
  document.head.appendChild(meta);

  var origin = location.origin;
  function isLocal(u) {
    try {
      var url = new URL(u, location.href);
      return url.origin === origin || url.protocol === "blob:" || url.protocol === "data:";
    } catch (e) { return false; }
  }
  function refuse(u) {
    window.AIRGAP.blocked++;
    var err = new Error("AIRGAP: blocked external request " + String(u).slice(0, 80));
    err.name = "AirgapBlocked";
    return err;
  }
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var u = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!isLocal(u)) return Promise.reject(refuse(u));
    return _fetch.call(this, input, init);
  };
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, u) {
    if (!isLocal(u)) throw refuse(u);
    return _open.apply(this, arguments);
  };
  if (window.WebSocket) window.WebSocket = function (u) { throw refuse(u); };
  if (window.EventSource) {
    var _ES = window.EventSource;
    window.EventSource = function (u, o) { if (!isLocal(u)) throw refuse(u); return new _ES(u, o); };
  }
  if (navigator.sendBeacon) navigator.sendBeacon = function (u) { refuse(u); return false; };
})();
