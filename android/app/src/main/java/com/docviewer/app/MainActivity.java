package com.docviewer.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileIntentPlugin.class); // 다른 앱에서 연 문서 받기
        super.onCreate(savedInstanceState);
    }
}
