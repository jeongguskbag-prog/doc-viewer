package com.docviewer.app;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileIntentPlugin.class); // 다른 앱에서 연 문서 받기
        registerPlugin(NativeIOPlugin.class);   // 내보내기: 저장·공유·인쇄
        super.onCreate(savedInstanceState);
        applySystemFontScale();
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemFontScale(); // 사용 중에 휴대폰 글꼴 크기를 바꿔도 반영
    }

    // 접근성: 휴대폰 [설정 → 글꼴 크기] 를 앱 화면 글자에도 적용 (WebView 는 기본으로 100% 고정)
    private void applySystemFontScale() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            float scale = getResources().getConfiguration().fontScale;
            int zoom = Math.round(Math.max(0.85f, Math.min(scale, 2.0f)) * 100);
            WebSettings ws = getBridge().getWebView().getSettings();
            if (ws.getTextZoom() != zoom) ws.setTextZoom(zoom);
        } catch (Exception ignored) {
            // 글꼴 배율을 못 읽어도 앱은 그대로 동작
        }
    }
}
