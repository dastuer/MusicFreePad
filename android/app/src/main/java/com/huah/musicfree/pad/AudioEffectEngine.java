package com.huah.musicfree.pad;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.PresetReverb;
import android.media.audiofx.Virtualizer;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import androidx.media3.exoplayer.ExoPlayer;

/**
 * 原生音效引擎：把 JS 音效面板的一套设置挂到 ExoPlayer 的音频会话上
 * （android.media.audiofx 效果链，随系统混音走，WebView 摸不到）。
 *
 * JS 侧（src/core/audioEffect.ts）每次设置变化整体下发一份 JSON：
 *   { enabled, eqs:[10 段 dB], bass, treble, surround, reverb }
 *
 * 与 Web Audio 链路的参数对应关系：
 *  - 十段 EQ：设备 Equalizer 的频点是 ROM 定的（常见 5 段），JS 的十段曲线
 *    按频点在对数频率轴上插值映射到各设备频段；
 *  - 高音（treble）：没有独立效果器，并入设备最高频段的增益；
 *  - 低音（bass）：>0 映射 BassBoost 强度（0~1000）；
 *  - 环绕强度（surround）：>0 映射 Virtualizer 强度（0~1000）；
 *  - 环境音效（reverb）：中文名映射 PresetReverb 的七档预设。
 *
 * 线程约定：apply/release 都在主线程调用（MediaPlaybackService.runOnMain）。
 * 全部参数读取包 try/catch——设备不支持某效果器时静默降级，绝不能因音效挂掉播放。
 */
public final class AudioEffectEngine {

    private static final String TAG = "AudioEffect";

    /** JS 十段均衡器频点（Hz），与 src/core/audioEffect.ts 的 EQ_BANDS 一致 */
    private static final double[] JS_BAND_FREQS = {31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};

    /** 最近一次下发的设置：服务重建（createPlayer）后按它重挂效果器 */
    private static volatile String lastJson = null;

    private static Equalizer equalizer;
    private static BassBoost bassBoost;
    private static Virtualizer virtualizer;
    private static PresetReverb reverb;
    /** 效果器当前挂的音频会话；换播放器（会话变化）时全部重建 */
    private static int attachedSessionId = 0;

    private AudioEffectEngine() {
    }

    static String getLastJson() {
        return lastJson;
    }

    /** 应用一份设置（enabled=false 或解析失败都会落到「全关」） */
    static synchronized void apply(ExoPlayer player, String json) {
        lastJson = json;
        if (player == null) {
            return;
        }
        int sessionId = player.getAudioSessionId();
        if (sessionId == 0) {
            // 会话还没就绪（尚未初始化音频输出）：等下次设置下发 / 歌曲装载后再挂
            return;
        }
        if (sessionId != attachedSessionId) {
            releaseEffects();
            attachedSessionId = sessionId;
        }

        boolean enabled = false;
        double[] eqs = new double[10];
        double bass = 0;
        double treble = 0;
        double surround = 0;
        String reverbName = "无";
        try {
            JSONObject obj = new JSONObject(json == null ? "{}" : json);
            enabled = obj.optBoolean("enabled", false);
            JSONArray arr = obj.optJSONArray("eqs");
            for (int i = 0; i < 10 && arr != null; i++) {
                eqs[i] = arr.optDouble(i, 0);
            }
            bass = obj.optDouble("bass", 0);
            treble = obj.optDouble("treble", 0);
            surround = obj.optDouble("surround", 0);
            reverbName = obj.optString("reverb", "无");
        } catch (Exception e) {
            Log.w(TAG, "音效设置解析失败，按关闭处理", e);
        }

        try {
            applyEqualizer(sessionId, enabled, eqs, treble);
        } catch (Exception e) {
            Log.w(TAG, "Equalizer 不可用", e);
        }
        try {
            applyBassBoost(sessionId, enabled && bass > 0, bass);
        } catch (Exception e) {
            Log.w(TAG, "BassBoost 不可用", e);
        }
        try {
            applyVirtualizer(sessionId, enabled && surround > 0, surround);
        } catch (Exception e) {
            Log.w(TAG, "Virtualizer 不可用", e);
        }
        try {
            applyReverb(sessionId, enabled, reverbName);
        } catch (Exception e) {
            Log.w(TAG, "PresetReverb 不可用", e);
        }
        Log.d(TAG, "音效已应用 enabled=" + enabled + " bass=" + bass
            + " treble=" + treble + " surround=" + surround + " reverb=" + reverbName);
    }

    /** 播放器销毁时释放效果器；lastJson 保留供新播放器重挂 */
    static synchronized void release() {
        releaseEffects();
        attachedSessionId = 0;
    }

    private static void releaseEffects() {
        quietRelease(equalizer);
        equalizer = null;
        quietRelease(bassBoost);
        bassBoost = null;
        quietRelease(virtualizer);
        virtualizer = null;
        quietRelease(reverb);
        reverb = null;
    }

    private static void quietRelease(android.media.audiofx.AudioEffect effect) {
        if (effect != null) {
            try {
                effect.setEnabled(false);
            } catch (Exception ignored) {
            }
            effect.release();
        }
    }

    /**
     * 十段曲线 → 设备 Equalizer 频段。
     * 设备频段中心频率落在 JS 曲线的两个频点之间时，在对数频率轴上线性插值
     * （每八度等距，与 EQ 推子的听感一致）；低于 31Hz 取首段、高于 16kHz 取末段。
     * treble 并入最高频段（Web Audio 侧是 6kHz 搁架，原生没有对应件，取近似）。
     */
    private static void applyEqualizer(int sessionId, boolean enabled, double[] eqs, double treble) {
        if (equalizer == null) {
            equalizer = new Equalizer(0, sessionId);
        }
        short bandCount = equalizer.getNumberOfBands();
        short[] range = equalizer.getBandLevelRange();
        for (short band = 0; band < bandCount; band++) {
            // getCenterFreq 返回毫赫兹
            double freqHz = equalizer.getCenterFreq(band) / 1000.0;
            double gain = interpGain(freqHz, eqs);
            if (band == bandCount - 1) {
                gain += treble;
            }
            int milliBel = Math.round((float) gain) * 100;
            if (milliBel < range[0]) {
                milliBel = range[0];
            }
            if (milliBel > range[1]) {
                milliBel = range[1];
            }
            equalizer.setBandLevel(band, (short) milliBel);
        }
        equalizer.setEnabled(enabled);
    }

    private static void applyBassBoost(int sessionId, boolean on, double bass) {
        if (bassBoost == null) {
            bassBoost = new BassBoost(0, sessionId);
        }
        if (bassBoost.hasControl()) {
            // bass ∈ (0,12] dB → 强度 0~1000
            short strength = (short) Math.min(1000, Math.max(0, Math.round(bass / 12.0 * 1000)));
            bassBoost.setStrength(strength);
            bassBoost.setEnabled(on && strength > 0);
        }
    }

    private static void applyVirtualizer(int sessionId, boolean on, double surround) {
        if (virtualizer == null) {
            virtualizer = new Virtualizer(0, sessionId);
        }
        if (virtualizer.hasControl()) {
            // surround ∈ (0,1] → 强度 0~1000
            short strength = (short) Math.min(1000, Math.max(0, Math.round(surround * 1000)));
            virtualizer.setStrength(strength);
            virtualizer.setEnabled(on && strength > 0);
        }
    }

    /** 环境音效中文名 → PresetReverb 七档预设（就近映射） */
    private static void applyReverb(int sessionId, boolean enabled, String name) {
        if (reverb == null) {
            reverb = new PresetReverb(0, sessionId);
        }
        short preset = PresetReverb.PRESET_NONE;
        if (enabled && name != null) {
            switch (name) {
                case "浴室": preset = PresetReverb.PRESET_SMALLROOM; break;
                case "房间": preset = PresetReverb.PRESET_MEDIUMROOM; break;
                case "地下通道": preset = PresetReverb.PRESET_LARGEROOM; break;
                case "大厅": preset = PresetReverb.PRESET_LARGEROOM; break;
                case "声乐板": preset = PresetReverb.PRESET_PLATE; break;
                case "弹簧": preset = PresetReverb.PRESET_PLATE; break;
                case "音乐厅": preset = PresetReverb.PRESET_MEDIUMHALL; break;
                case "演唱会": preset = PresetReverb.PRESET_MEDIUMHALL; break;
                case "教堂": preset = PresetReverb.PRESET_LARGEHALL; break;
                case "夜店": preset = PresetReverb.PRESET_MEDIUMROOM; break;
                default: preset = PresetReverb.PRESET_NONE; break;
            }
        }
        reverb.setPreset(preset);
        reverb.setEnabled(enabled && preset != PresetReverb.PRESET_NONE);
    }

    /** 对数频率轴上线性插值十段曲线 */
    private static double interpGain(double freqHz, double[] eqs) {
        if (freqHz <= JS_BAND_FREQS[0]) {
            return eqs[0];
        }
        if (freqHz >= JS_BAND_FREQS[JS_BAND_FREQS.length - 1]) {
            return eqs[JS_BAND_FREQS.length - 1];
        }
        for (int i = 0; i < JS_BAND_FREQS.length - 1; i++) {
            if (freqHz <= JS_BAND_FREQS[i + 1]) {
                double t = (Math.log(freqHz) - Math.log(JS_BAND_FREQS[i]))
                    / (Math.log(JS_BAND_FREQS[i + 1]) - Math.log(JS_BAND_FREQS[i]));
                return eqs[i] + t * (eqs[i + 1] - eqs[i]);
            }
        }
        return 0;
    }
}
