package com.docviewer.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 다른 앱(카카오톡, Gmail, 내 파일 등)에서 "열기"/"공유"로 넘겨받은 문서를 앱 캐시에 복사하고
 * 웹앱에 "fileOpened" 이벤트로 알린다. 웹앱은 Capacitor.convertFileSrc(path)로 파일을 읽는다.
 * 웹앱이 아직 로드되기 전이면 이벤트는 리스너가 붙을 때까지 보관된다(retainUntilConsumed).
 */
@CapacitorPlugin(name = "FileIntent")
public class FileIntentPlugin extends Plugin {

    private static final String HANDLED_EXTRA = "com.docviewer.app.HANDLED";
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        cleanOldFiles();
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getBooleanExtra(HANDLED_EXTRA, false)) return;
        List<Uri> uris = collectUris(intent);
        if (uris.isEmpty()) return;
        intent.putExtra(HANDLED_EXTRA, true); // 화면 재생성 시 같은 파일을 다시 열지 않도록
        final String type = intent.getType();
        io.execute(() -> {
            for (Uri uri : uris) {
                try {
                    notifyListeners("fileOpened", copyToCache(uri, type), true);
                } catch (Exception e) {
                    Logger.error("FileIntent", "Could not open " + uri, e);
                    JSObject err = new JSObject();
                    err.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                    notifyListeners("fileOpened", err, true);
                }
            }
        });
    }

    @SuppressWarnings("deprecation")
    private List<Uri> collectUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        return uris;
    }

    private JSObject copyToCache(Uri uri, String intentType) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        String mime = cr.getType(uri);
        if (mime == null) mime = intentType;
        String name = displayName(cr, uri);
        name = ensureExtension(sanitize(name), mime);

        File dir = new File(getContext().getCacheDir(), "opened/" + System.currentTimeMillis());
        if (!dir.mkdirs() && !dir.isDirectory()) throw new Exception("cache dir");
        File out = new File(dir, name);
        long total = 0;
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("cannot read file");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new Exception("file too large");
                os.write(buf, 0, n);
            }
        }
        JSObject ret = new JSObject();
        ret.put("path", out.getAbsolutePath());
        ret.put("name", name);
        ret.put("mime", mime == null ? "" : mime);
        ret.put("size", total);
        return ret;
    }

    private String displayName(ContentResolver cr, Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    String n = c.getString(0);
                    if (n != null && !n.isEmpty()) return n;
                }
            } catch (Exception ignored) {}
        }
        String seg = uri.getLastPathSegment();
        return seg == null || seg.isEmpty() ? "document" : seg;
    }

    private static String sanitize(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) n = "document";
        return n.length() > 120 ? n.substring(n.length() - 120) : n;
    }

    /** 이름에 확장자가 없으면 MIME 형식으로 붙인다 (예: 카카오톡이 확장자 없이 넘기는 경우). */
    private static String ensureExtension(String name, String mime) {
        if (name.matches(".*\\.[A-Za-z0-9]{2,5}$") || mime == null) return name;
        String ext;
        switch (mime) {
            case "application/x-hwp":
            case "application/haansofthwp":
            case "application/vnd.hancom.hwp":
                ext = "hwp"; break;
            case "application/hwp+zip":
            case "application/vnd.hancom.hwpx":
            case "application/haansofthwpx":
                ext = "hwpx"; break;
            case "text/markdown":
            case "text/x-markdown":
                ext = "md"; break;
            default:
                ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        }
        return ext == null ? name : name + "." + ext;
    }

    private void cleanOldFiles() {
        io.execute(() -> deleteRecursive(new File(getContext().getCacheDir(), "opened")));
    }

    private static void deleteRecursive(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
