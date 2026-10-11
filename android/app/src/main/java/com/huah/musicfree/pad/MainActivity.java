package com.huah.musicfree.pad;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册：BridgeActivity.onCreate 里就会构建 bridge，
        // 之后再 registerPlugin 就加不进去了
        registerPlugin(MediaNotificationPlugin.class);
        registerPlugin(StoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
