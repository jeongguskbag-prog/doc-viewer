package com.docviewer.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 웹앱의 내보내기를 안드로이드에서 실제로 동작시키는 플러그인.
 * WebView 는 <a download>, navigator.share, window.print 를 지원하지 않으므로 네이티브로 처리한다.
 *  - save : 다운로드 폴더에 저장 (Android 10+ MediaStore, 그 이하는 저장 위치 선택 화면)
 *  - share: 안드로이드 공유 화면 (카카오톡·메일 등)
 *  - print: 안드로이드 인쇄 화면 (PDF로 저장 포함)
 */
@CapacitorPlugin(name = "NativeIO")
public class NativeIOPlugin extends Plugin {

    private WebView printView; // 인쇄가 끝날 때까지 참조 유지

    @PluginMethod
    public void save(PluginCall call) {
        String name = safeName(call.getString("name", "document"));
        String mime = call.getString("mime", "application/octet-stream");
        byte[] bytes;
        try { bytes = decode(call); } catch (Exception e) { call.reject("bad data"); return; }

        if (Build.VERSION.SDK_INT >= 29) {
            try {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("insert failed");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new Exception("open failed");
                    os.write(bytes);
                }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                JSObject ret = new JSObject();
                ret.put("name", name);
                ret.put("folder", "Download");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("save failed: " + e.getMessage());
            }
            return;
        }
        // Android 9 이하: 사용자가 저장 위치를 고름 (권한 필요 없음)
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onSaveLocation");
    }

    @ActivityCallback
    private void onSaveLocation(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled", "CANCELLED");
            return;
        }
        try (OutputStream os = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if (os == null) throw new Exception("open failed");
            os.write(decode(call));
            JSObject ret = new JSObject();
            ret.put("name", call.getString("name"));
            ret.put("folder", "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    /** 첨부용 임시 파일을 캐시에 쓰고 다른 앱이 읽을 수 있는 content:// 주소를 돌려줌 */
    private Uri writeShareFile(PluginCall call, String name) throws Exception {
        File dir = new File(getContext().getCacheDir(), "share");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
        if (!dir.mkdirs() && !dir.isDirectory()) throw new Exception("cache dir");
        File out = new File(dir, name);
        try (FileOutputStream os = new FileOutputStream(out)) { os.write(decode(call)); }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
    }

    /** 이메일 앱만 뜨도록 메일 작성 화면을 열고 파일을 첨부 (받는 사람·제목·본문 미리 채움) */
    @PluginMethod
    public void email(PluginCall call) {
        String name = safeName(call.getString("name", "document"));
        String mime = call.getString("mime", "application/octet-stream");
        try {
            Uri uri = writeShareFile(call, name);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            String to = call.getString("to", "").trim();
            if (!to.isEmpty()) send.putExtra(Intent.EXTRA_EMAIL, to.split("\\s*[,;]\\s*"));
            send.putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", name));
            send.putExtra(Intent.EXTRA_TEXT, call.getString("body", ""));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // mailto 선택자: 카카오톡 등은 빼고 메일 앱만 보여 줌
            send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
            Intent chooser = Intent.createChooser(send, call.getString("title", name));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                getActivity().startActivity(chooser);
            } catch (android.content.ActivityNotFoundException e) {
                send.setSelector(null); // 메일 앱이 없으면 일반 공유 화면
                getActivity().startActivity(Intent.createChooser(send, name));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("email failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String name = safeName(call.getString("name", "document"));
        String mime = call.getString("mime", "application/octet-stream");
        try {
            Uri uri = writeShareFile(call, name);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", name));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html", "");
        String name = call.getString("name", "document");
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = new WebView(getActivity());
                wv.getSettings().setJavaScriptEnabled(false);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager pm = (PrintManager) getActivity().getSystemService(android.content.Context.PRINT_SERVICE);
                        pm.print(name, view.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                        call.resolve();
                    }
                });
                printView = wv;
                wv.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("print failed: " + e.getMessage());
            }
        });
    }

    private static byte[] decode(PluginCall call) {
        return Base64.decode(call.getString("data", ""), Base64.DEFAULT);
    }

    private static String safeName(String n) {
        String s = n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        return s.isEmpty() ? "document" : s;
    }
}
