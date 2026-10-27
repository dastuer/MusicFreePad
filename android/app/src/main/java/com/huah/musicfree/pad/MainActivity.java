package com.huah.musicfree.pad;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册：BridgeActivity.onCreate 里就会构建 bridge，
        // 之后再 registerPlugin 就加不进去了
        registerPlugin(PlaybackBridge.class);
        registerPlugin(StoragePlugin.class);
        registerPlugin(LocalMusicPlugin.class);
        registerPlugin(DavHttpPlugin.class);
        // 检查更新：读安装包版本 / 算更新包路径 / 拉起系统安装器（见 UpdatePlugin）
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        // 本地音乐的系统删除确认框（MediaStore.createDeleteRequest）结果回传
        LocalMusicPlugin.dispatchDeleteResult(requestCode, resultCode);
        super.onActivityResult(requestCode, resultCode, data);
    }
}
