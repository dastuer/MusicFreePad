package com.huah.musicfree.pad;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 存储访问插件：应用私有目录路径 + 绝对路径分块写入 / 删除 / 状态查询，
 * 供「播放缓存」（core/audioCache.ts）使用。
 *
 * 为什么不走 Filesystem 插件：Android 13+ 上它对公共目录自带运行时权限门禁，
 * 且缓存写的是应用私有 cacheDir——java.io.File 直写没有任何权限问题，
 * 路径由本插件给出（getDefaultDirs），JS 侧只管按绝对路径读写。
 *
 * 与 MediaNotificationPlugin 同模式：JS 侧经 bridge 的 nativePromise 调用，
 * 不打包插件 JS 运行时。
 */
@CapacitorPlugin(name = "Storage")
public class StoragePlugin extends Plugin {

    /* ---------- 目录 ---------- */

    /**
     * 应用私有目录：cacheDir（播放缓存写入处，系统存储紧张时可整体回收）与 filesDir（兜底）。
     */
    @PluginMethod
    public void getDefaultDirs(PluginCall call) {
        JSObject res = new JSObject();
        res.put("filesDir", getContext().getFilesDir().getAbsolutePath());
        res.put("cacheDir", getContext().getCacheDir().getAbsolutePath());
        call.resolve(res);
    }

    /* ---------- 写入 / 删除 / 状态 ---------- */

    /**
     * 绝对路径分块写入（base64）：首块建文件，后续 append。
     * 与 JS 侧播放缓存通道的 ~1MB 分块约定一致；父目录自动创建。
     */
    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String data = call.getString("data");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append"));
        if (path == null || path.trim().isEmpty() || data == null) {
            call.reject("缺少写入参数");
            return;
        }
        File file = new File(path.trim());
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                call.reject("无法创建目标文件夹");
                return;
            }
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            try (OutputStream out = new FileOutputStream(file, append)) {
                out.write(bytes);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("写入失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("缺少文件路径");
            return;
        }
        File file = new File(path.trim());
        boolean deleted = !file.exists() || file.delete();
        JSObject res = new JSObject();
        res.put("deleted", deleted);
        call.resolve(res);
    }

    /** 文件存在性与大小（播放缓存命中时校验文件是否仍在） */
    @PluginMethod
    public void statFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("缺少文件路径");
            return;
        }
        File file = new File(path.trim());
        JSObject res = new JSObject();
        res.put("exists", file.exists());
        res.put("size", file.length());
        res.put("isDirectory", file.isDirectory());
        call.resolve(res);
    }
}
