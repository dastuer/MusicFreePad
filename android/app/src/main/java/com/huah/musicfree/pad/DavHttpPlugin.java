package com.huah.musicfree.pad;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV HTTP 插件：给 WebDAV 备份（core/dav.ts）提供任意 HTTP 方法支持。
 *
 * 为什么不走 CapacitorHttp：它的 Android 底层是 HttpURLConnection，
 * setRequestMethod 只认 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/PATCH 八个标准方法，
 * PROPFIND / MKCOL 直接抛 ProtocolException（表现为 WebDAV 备份报
 * "Expected one of [...] but was PROPFIND"）。OkHttp 的 Request.Builder.method()
 * 不做方法白名单校验；iOS 的 CapacitorHttp 走 NSURLSession 本就无此限制，不用本插件。
 *
 * 与 StoragePlugin / MediaNotificationPlugin 同模式：JS 侧经 bridge 的
 * nativePromise 调用，不打包插件 JS 运行时。
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {

    private OkHttpClient client;

    @Override
    public void load() {
        client = new OkHttpClient();
    }

    @PluginMethod
    public void request(final PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少请求地址");
            return;
        }
        if (method == null || method.isEmpty()) {
            method = "GET";
        }

        int timeoutMs = call.getInt("timeoutMs", 30000);
        // newBuilder 共享连接池与线程池，只是覆写超时
        OkHttpClient scoped = client.newBuilder()
                .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();

        JSObject headers = call.getObject("headers");
        Request.Builder builder = new Request.Builder().url(url.trim());
        String contentType = null;
        if (headers != null) {
            java.util.Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String name = keys.next();
                Object value = headers.opt(name);
                if (name == null || value == null) {
                    continue;
                }
                if ("content-type".equalsIgnoreCase(name)) {
                    contentType = String.valueOf(value);
                }
                builder.header(name, String.valueOf(value));
            }
        }

        // GET/HEAD 不允许带请求体；其余方法（含 PROPFIND/MKCOL）OkHttp 均可显式给体
        String body = call.getString("body");
        MediaType type = MediaType.parse(contentType != null ? contentType : "application/octet-stream");
        if (body != null && !body.isEmpty() && !"GET".equals(method) && !"HEAD".equals(method)) {
            // 4.x 里 Java 侧仅保留旧参数序的 create（标记过时），新签名是 Kotlin 扩展
            builder.method(method, RequestBody.create(type, body));
        } else if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
            // 这几个方法 OkHttp 强制要求请求体，空内容也要给空体
            builder.method(method, RequestBody.create(type, ""));
        } else {
            builder.method(method, null);
        }

        scoped.newCall(builder.build()).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(Call c, java.io.IOException e) {
                String msg = e.getMessage();
                call.reject(msg != null ? msg : e.getClass().getSimpleName());
            }

            @Override
            public void onResponse(Call c, Response resp) {
                JSObject res = new JSObject();
                res.put("status", resp.code());
                JSObject respHeaders = new JSObject();
                for (Map.Entry<String, List<String>> h : resp.headers().toMultimap().entrySet()) {
                    respHeaders.put(h.getKey().toLowerCase(Locale.ROOT), String.join(", ", h.getValue()));
                }
                res.put("headers", respHeaders);
                ResponseBody respBody = resp.body();
                String text = "";
                try {
                    text = respBody != null ? respBody.string() : "";
                } catch (java.io.IOException ignored) {
                }
                res.put("text", text);
                call.resolve(res);
            }
        });
    }
}
