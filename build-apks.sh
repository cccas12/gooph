#!/usr/bin/env bash
set -euo pipefail

# WASELHA 3-App Signed Android APK Builder (Temurin JDK 17 + Android SDK 34: aapt2 + javac + d8 + zipalign + apksigner)
export JAVA_HOME="${JAVA_HOME:-/opt/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
export PATH="${JAVA_HOME}/bin:${ANDROID_HOME}/build-tools/34.0.0:${PATH}"

BUILD_TOOLS="${ANDROID_HOME}/build-tools/34.0.0"
ANDROID_JAR="${ANDROID_HOME}/platforms/android-34/android.jar"

CLOUD_API_URL="${VITE_API_URL:-${VITE_API_BASE_URL:-https://wsse-production.up.railway.app}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOADS_DIR="${ROOT_DIR}/downloads"
KEYSTORE_PATH="/opt/waselha-signing/waselha-release.jks"
KEYSTORE_PASS="WaselhaIQ#2026"
KEY_ALIAS="waselha-key"
WORK_ROOT="/tmp/waselha-apk-work"

mkdir -p "${DOWNLOADS_DIR}" "${WORK_ROOT}/icongen"

echo "==> Building standalone web bundles (API: ${CLOUD_API_URL}) for APKs..."
cd "${ROOT_DIR}"
VITE_API_URL="${CLOUD_API_URL}" VITE_API_BASE_URL="${CLOUD_API_URL}" npm run build:customer
VITE_API_URL="${CLOUD_API_URL}" VITE_API_BASE_URL="${CLOUD_API_URL}" npm run build:driver
VITE_API_URL="${CLOUD_API_URL}" VITE_API_BASE_URL="${CLOUD_API_URL}" npm run build:manager
npm run build

# Compile tiny Java ImageIO icon/splash generator once (zero external Python deps)
cat > "${WORK_ROOT}/icongen/IconGen.java" <<'JAVA'
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class IconGen {
    public static void main(String[] args) throws Exception {
        File srcFile = new File(args[0]);
        File resDir = new File(args[1]);
        int r = Integer.parseInt(args[2]);
        int g = Integer.parseInt(args[3]);
        int b = Integer.parseInt(args[4]);
        Color bg = new Color(r, g, b, 255);
        BufferedImage src = ImageIO.read(srcFile);

        String[] folders = {"mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"};
        int[] sizes = {48, 72, 96, 144, 192};

        for (int i = 0; i < folders.length; i++) {
            File dir = new File(resDir, folders[i]);
            dir.mkdirs();
            int px = sizes[i];
            BufferedImage out = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g2 = out.createGraphics();
            g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setColor(bg);
            g2.fillRect(0, 0, px, px);
            int inner = Math.round(px * 0.82f);
            int off = (px - inner) / 2;
            g2.drawImage(src, off, off, inner, inner, null);
            g2.dispose();
            ImageIO.write(out, "png", new File(dir, "ic_launcher.png"));
            ImageIO.write(out, "png", new File(dir, "ic_launcher_round.png"));
        }

        File drawDir = new File(resDir, "drawable");
        drawDir.mkdirs();
        BufferedImage sp = new BufferedImage(280, 280, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = sp.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.drawImage(src, 0, 0, 280, 280, null);
        g2.dispose();
        ImageIO.write(sp, "png", new File(drawDir, "splash_logo.png"));
    }
}
JAVA
javac -d "${WORK_ROOT}/icongen" "${WORK_ROOT}/icongen/IconGen.java"

build_native_apk() {
  local APP_KEY="$1"
  local PKG_ID="$2"
  local APP_LABEL="$3"
  local START_ROUTE="$4"
  local WEB_DIST="$5"
  local APK_FILENAME="$6"
  local BG_HEX="$7"
  local BG_R="$8"
  local BG_G="$9"
  local BG_B="${10}"

  local APP_WORK="${WORK_ROOT}/${APP_KEY}"
  local PKG_PATH="${PKG_ID//./\/}"
  rm -rf "${APP_WORK}"
  mkdir -p "${APP_WORK}/src/${PKG_PATH}" "${APP_WORK}/res/values" "${APP_WORK}/res/drawable" \
           "${APP_WORK}/assets/www" "${APP_WORK}/obj" "${APP_WORK}/dex" "${APP_WORK}/gen"

  echo "==> Building ${APK_FILENAME} (${PKG_ID})..."

  # Copy compiled standalone Vite bundle into APK assets/www
  cp -r "${ROOT_DIR}/${WEB_DIST}/." "${APP_WORK}/assets/www/"

  # Generate AndroidManifest.xml
  cat > "${APP_WORK}/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${PKG_ID}"
    android:versionCode="1"
    android:versionName="1.0.0">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:label="${APP_LABEL}"
        android:supportsRtl="true"
        android:theme="@style/WaselhaTheme"
        android:usesCleartextTraffic="false">
        <activity
            android:name="${PKG_ID}.MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden|locale|layoutDirection"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

  cat > "${APP_WORK}/res/values/styles.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="WaselhaTheme" parent="@android:style/Theme.Material.Light.NoActionBar">
        <item name="android:windowBackground">@drawable/splash_layer</item>
        <item name="android:statusBarColor">${BG_HEX}</item>
        <item name="android:navigationBarColor">#FFFFFF</item>
    </style>
</resources>
EOF

  cat > "${APP_WORK}/res/drawable/splash_layer.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/splash_bg" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/splash_logo" />
    </item>
</layer-list>
EOF

  cat > "${APP_WORK}/res/drawable/splash_bg.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${BG_HEX}" />
</shape>
EOF

  java -cp "${WORK_ROOT}/icongen" IconGen "${ROOT_DIR}/public/pwa-512x512.png" "${APP_WORK}/res" "${BG_R}" "${BG_G}" "${BG_B}"

  cat > "${APP_WORK}/src/${PKG_PATH}/MainActivity.java" <<EOF
package ${PKG_ID};

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String BASE_ORIGIN = "${CLOUD_API_URL}";
    private static final String START_URL = BASE_ORIGIN + "${START_ROUTE}";
    private static final int REQ_LOC = 1001;
    private static final int REQ_FILE = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#F8FAFC"));
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                    REQ_LOC
                );
            }
        }

        final AssetManager assets = getAssets();
        final Uri baseUri = Uri.parse(BASE_ORIGIN);
        final String appHost = baseUri.getHost();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                if ("tel".equals(scheme) || "mailto".equals(scheme) || "geo".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_DIAL, uri));
                    } catch (Exception ignored) {}
                    return true;
                }
                String host = uri.getHost() != null ? uri.getHost() : "";
                if (!host.isEmpty() && !host.equalsIgnoreCase(appHost)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        return true;
                    } catch (Exception ignored) {}
                }
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() != null ? uri.getHost() : "";
                if (!host.equalsIgnoreCase(appHost)) {
                    return null;
                }
                String path = uri.getPath() != null ? uri.getPath() : "/";
                if (path.startsWith("/api/") || path.startsWith("/uploads/") || path.startsWith("/downloads/")) {
                    return null;
                }

                String relPath = path.startsWith("/") ? path.substring(1) : path;
                String appPrefix = "${APP_KEY}";
                if (relPath.equals(appPrefix) || relPath.equals(appPrefix + "/")) {
                    relPath = "index.html";
                } else if (relPath.startsWith(appPrefix + "/")) {
                    relPath = relPath.substring(appPrefix.length() + 1);
                }
                if (relPath.isEmpty() || relPath.equals("customer") || relPath.equals("driver") || relPath.equals("manager")) {
                    relPath = "index.html";
                }

                try {
                    InputStream is = assets.open("www/" + relPath);
                    return buildResponse(relPath, is);
                } catch (Exception e) {
                    if (!relPath.contains(".")) {
                        try {
                            InputStream idx = assets.open("www/index.html");
                            return buildResponse("index.html", idx);
                        } catch (Exception ignored) {}
                    }
                    return null;
                }
            }

            private WebResourceResponse buildResponse(String filePath, InputStream stream) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(guessMime(filePath), "UTF-8", 200, "OK", headers, stream);
            }

            private String guessMime(String path) {
                String p = path.toLowerCase();
                if (p.endsWith(".html")) return "text/html";
                if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
                if (p.endsWith(".css")) return "text/css";
                if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
                if (p.endsWith(".png")) return "image/png";
                if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
                if (p.endsWith(".svg")) return "image/svg+xml";
                if (p.endsWith(".woff2")) return "font/woff2";
                if (p.endsWith(".woff")) return "font/woff";
                return "application/octet-stream";
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = filePathCallback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        webView.loadUrl(START_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
EOF

  "${BUILD_TOOLS}/aapt2" compile --dir "${APP_WORK}/res" -o "${APP_WORK}/res.zip"
  "${BUILD_TOOLS}/aapt2" link \
    -o "${APP_WORK}/unaligned.apk" \
    -I "${ANDROID_JAR}" \
    --manifest "${APP_WORK}/AndroidManifest.xml" \
    --java "${APP_WORK}/gen" \
    -A "${APP_WORK}/assets" \
    "${APP_WORK}/res.zip"

  javac --release 8 -classpath "${ANDROID_JAR}" -d "${APP_WORK}/obj" \
    "${APP_WORK}/src/${PKG_PATH}/MainActivity.java" \
    "${APP_WORK}/gen/${PKG_PATH}/R.java"

  mapfile -t CLASS_FILES < <(find "${APP_WORK}/obj" -name "*.class")
  "${BUILD_TOOLS}/d8" --lib "${ANDROID_JAR}" --min-api 24 --output "${APP_WORK}/dex" "${CLASS_FILES[@]}"

  python3 - <<PY
import zipfile
with zipfile.ZipFile('${APP_WORK}/unaligned.apk', 'a') as zf:
    zf.write('${APP_WORK}/dex/classes.dex', 'classes.dex')
PY

  local OUT_APK="${DOWNLOADS_DIR}/${APK_FILENAME}"
  rm -f "${OUT_APK}"
  "${BUILD_TOOLS}/zipalign" -p -f 4 "${APP_WORK}/unaligned.apk" "${APP_WORK}/aligned.apk"
  "${BUILD_TOOLS}/apksigner" sign \
    --ks "${KEYSTORE_PATH}" \
    --ks-pass "pass:${KEYSTORE_PASS}" \
    --key-pass "pass:${KEYSTORE_PASS}" \
    --ks-key-alias "${KEY_ALIAS}" \
    --out "${OUT_APK}" \
    "${APP_WORK}/aligned.apk"

  "${BUILD_TOOLS}/apksigner" verify --verbose "${OUT_APK}" >/dev/null
  rm -f "${OUT_APK}.idsig"
  echo "==> Signed & Verified: ${OUT_APK}"
}

build_native_apk "customer" "iq.waselha.customer" "وصلها للزبائن - WASELHA" "/customer" "dist-customer" "WASELHA CUSTOMER.apk" "#0284C7" 2 132 199
build_native_apk "driver"   "iq.waselha.driver"   "وصلها للمندوبين - WASELHA" "/driver" "dist-driver" "WASELHA DRIVER.apk" "#0369A1" 3 105 161
build_native_apk "manager"  "iq.waselha.manager"  "وصلها للإدارة - WASELHA" "/manager" "dist-manager" "WASELHA MANAGER.apk" "#0F172A" 15 23 42

rm -rf "${WORK_ROOT}"

echo "==> Creating final source code & database backup archive..."
cd "${ROOT_DIR}"
rm -f "${DOWNLOADS_DIR}/waselha-project-backup.tar.gz"
tar -czf "${DOWNLOADS_DIR}/waselha-project-backup.tar.gz" \
  package.json tsconfig.json vite.config.ts index.html metadata.json \
  firebase-applet-config.json firestore.rules firebase-blueprint.json security_spec.md \
  src public mobile server.ts dist-customer dist-driver dist-manager data/waselha-db.json data/backups

ls -lh "${DOWNLOADS_DIR}"
echo "==> ALL 3 SIGNED APKS AND BACKUP ARCHIVE READY!"
