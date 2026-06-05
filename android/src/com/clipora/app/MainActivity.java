package com.clipora.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Clipora shell: the web app is bundled in assets/www and served from a
 * secure https origin, so IndexedDB, MediaRecorder, ES modules and the
 * Whisper model cache all work offline. A small bridge handles saving and
 * sharing exported files and keeping the screen on during export.
 */
public class MainActivity extends Activity {
    static final String TAG = "Clipora";
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/index.html";
    static final int PICK_FILES = 1;
    static final int BG = 0xFFFBF5E9;

    static final int MIC = 3;
    WebView web;
    ValueCallback<Uri[]> pendingPick;
    PermissionRequest pendingMic;

    @Override
    public void onRequestPermissionsResult(int request, String[] perms, int[] results) {
        super.onRequestPermissionsResult(request, perms, results);
        if (request != MIC || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingMic.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else pendingMic.deny();
        pendingMic = null;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Cream theme: dark status/navigation bar icons.
        if (Build.VERSION.SDK_INT >= 30) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(light, light);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        // targetSdk 35 draws edge-to-edge: keep the page clear of the system bars and keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "CliporaNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__cliporaBack ? window.__cliporaBack() : false", (res) -> {
            if (!"true".equals(res)) finish();
        });
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    // ---------- Serving the bundled app ----------
    class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream in = getAssets().open("www" + path);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime(path), null, 200, "OK", headers, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (HOST.equals(req.getUrl().getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl()));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }
    }

    static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    // ---------- <input type=file> ----------
    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (pendingPick != null) pendingPick.onReceiveValue(null);
            pendingPick = cb;
            List<String> types = new ArrayList<>();
            boolean any = false;
            for (String t : params.getAcceptTypes()) {
                for (String one : t.split(",")) {
                    one = one.trim();
                    if (one.isEmpty()) continue;
                    if (one.startsWith(".")) any = true; // extensions (e.g. .srt) have no reliable MIME type
                    else types.add(one);
                }
            }
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            if (!any && !types.isEmpty()) i.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try {
                startActivityForResult(Intent.createChooser(i, null), PICK_FILES);
                return true;
            } catch (ActivityNotFoundException e) {
                pendingPick = null;
                return false;
            }
        }

        // Microphone for voice-over: ask Android for the permission, then grant it to the page.
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            runOnUiThread(() -> {
                boolean wantsMic = false;
                for (String r : req.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                if (!wantsMic) {
                    req.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingMic = req;
                    requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC);
                }
            });
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || pendingPick == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                uris = new Uri[n];
                for (int k = 0; k < n; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[] {data.getData()};
            }
        }
        pendingPick.onReceiveValue(uris);
        pendingPick = null;
    }

    // ---------- Native bridge (called from js/app.js) ----------
    class Bridge {
        final Map<String, File> files = new HashMap<>();
        final Map<String, OutputStream> outs = new HashMap<>();
        final Map<String, String> errors = new HashMap<>();
        int next = 0;

        @JavascriptInterface
        public synchronized String begin() {
            try {
                String id = "f" + (next++);
                File f = new File(getCacheDir(), "export-" + id + "-" + System.currentTimeMillis());
                files.put(id, f);
                outs.put(id, new FileOutputStream(f));
                return id;
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public synchronized void append(String id, String b64) {
            OutputStream o = outs.get(id);
            if (o == null || errors.containsKey(id)) return;
            try {
                o.write(Base64.decode(b64, Base64.DEFAULT));
            } catch (Exception e) {
                errors.put(id, String.valueOf(e.getMessage()));
            }
        }

        /** Saves the file to the gallery/Downloads; returns "" on success or an error message. */
        @JavascriptInterface
        public synchronized String finish(String id, String name, String mimeType, boolean share) {
            File f = files.remove(id);
            OutputStream o = outs.remove(id);
            String err = errors.remove(id);
            if (f == null || o == null) return "Save failed";
            if (err != null) {
                try { o.close(); } catch (IOException ignored) { }
                f.delete();
                return "Save failed: " + err;
            }
            String type = mimeType.split(";")[0].trim();
            boolean video = type.startsWith("video/");
            try {
                o.close();
                if (Build.VERSION.SDK_INT >= 29) {
                    Uri uri = saveMediaStore(f, name, type, video);
                    if (share) share(uri, type);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[] {Manifest.permission.WRITE_EXTERNAL_STORAGE}, 2));
                        return "Allow storage access, then tap again";
                    }
                    saveLegacy(f, name, type, video, share);
                }
                return "";
            } catch (Exception e) {
                Log.e(TAG, "save", e);
                return "Save failed: " + e.getMessage();
            } finally {
                f.delete();
            }
        }

        /** Caption (title, music credit, hashtags) sent along with the next shared file. */
        @JavascriptInterface
        public void setShareText(String text) {
            shareText = text;
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }

    Uri saveMediaStore(File f, String name, String type, boolean video) throws IOException {
        ContentResolver cr = getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS) + "/Clipora");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = cr.insert(collection, v);
        if (uri == null) throw new IOException("MediaStore insert failed");
        try (InputStream in = new FileInputStream(f); OutputStream out = cr.openOutputStream(uri)) {
            copy(in, out);
        } catch (IOException e) {
            cr.delete(uri, null, null);
            throw e;
        }
        v.clear();
        v.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(uri, v, null, null);
        return uri;
    }

    void saveLegacy(File f, String name, String type, boolean video, boolean share) throws IOException {
        File dir = new File(Environment.getExternalStoragePublicDirectory(video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS), "Clipora");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);
        File dest = new File(dir, name);
        String base = name.replaceFirst("\\.[^.]*$", ""), ext = name.substring(base.length());
        for (int n = 1; dest.exists(); n++) dest = new File(dir, base + " (" + n + ")" + ext);
        try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(this, new String[] {dest.getAbsolutePath()}, new String[] {type}, (path, uri) -> {
            if (share && uri != null) share(uri, type);
        });
    }

    volatile String shareText = null;

    void share(Uri uri, String type) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(type);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        if (shareText != null && !shareText.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, shareText);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(() -> {
            try {
                startActivity(Intent.createChooser(send, null));
            } catch (ActivityNotFoundException ignored) {
            }
        });
    }

    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[1 << 16];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    }
}
