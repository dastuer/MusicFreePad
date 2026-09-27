import { useEffect, useRef, useState } from "react";
import {
    setTheme,
    useThemeSetting,
    type ThemeSetting,
} from "@/core/theme";
import {
    setDefaultQuality,
    useQuality,
} from "@/core/trackPlayer";
import { getConfig, setConfig } from "@/core/appConfig";
import { getProxyBase, setProxyBase, testProxy } from "@/core/net";
import {
    exportBackupToLocal,
    importBackupFromLocal,
    getBackupCounts,
    exportBackupToWebdav,
    importBackupFromWebdav,
    importBackupFromUrl,
    RESUME_MODE_OPTIONS,
    getResumeMode,
    setResumeMode,
    describeResumeSummary,
    type ResumeMode,
    type IBackupCounts,
} from "@/core/backup";
import {
    getWebdavConfig,
    setWebdavConfig,
    testWebdav,
    getWebdavLastAt,
    DEFAULT_WEBDAV_FILE_PATH,
    type IWebdavConfig,
} from "@/core/dav";
import { isNative } from "@/core/native";
import { showToast } from "@/core/uiAtoms";

/** 设置：外观 / 播放 / 网络 / 备份（本地文件、URL、WebDAV，与桌面端互通） */
export default function SettingsPage() {
    const themeSetting = useThemeSetting();
    const quality = useQuality();
    const [rememberProgress, setRememberProgress] = useState(getConfig("rememberProgress", true) !== false);
    const [proxyBase, setProxyBaseState] = useState(getProxyBase());
    const [proxyTestMsg, setProxyTestMsg] = useState<string | null>(null);
    const [counts, setCounts] = useState<IBackupCounts | null>(null);
    const [mode, setMode] = useState<ResumeMode>(getResumeMode());
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const native = isNative();
    const [dav, setDav] = useState<IWebdavConfig>(() => getWebdavConfig());
    const [davTestMsg, setDavTestMsg] = useState<string | null>(null);
    const [davLastUpload, setDavLastUpload] = useState<number | null>(() =>
        getWebdavLastAt("upload"),
    );
    const [urlRestore, setUrlRestore] = useState("");

    useEffect(() => {
        getBackupCounts().then(setCounts);
    }, [busy]);

    const applyRestored = (summaryText: string) => {
        showToast(summaryText, 4500);
        // 偏好（播放队列等）写入 localStorage，刷新后全面生效
        setTimeout(() => location.reload(), 1600);
    };

    const doExport = async () => {
        setBusy(true);
        const res = await exportBackupToLocal();
        setBusy(false);
        showToast(
            res.success ? `备份已导出（${res.sizeText ?? ""}）` : res.message ?? "导出失败",
        );
    };

    const doImport = async (file: File) => {
        setBusy(true);
        try {
            const { summary } = await importBackupFromLocal(file, mode);
            applyRestored(describeResumeSummary(summary));
        } catch (e: any) {
            showToast(e?.message ?? "恢复失败");
            setBusy(false);
        }
    };

    const doUrlRestore = async () => {
        const url = urlRestore.trim();
        if (!url) {
            return;
        }
        setBusy(true);
        try {
            const { summary } = await importBackupFromUrl(url, mode);
            applyRestored(describeResumeSummary(summary));
        } catch (e: any) {
            showToast(e?.message ?? "从 URL 恢复失败");
            setBusy(false);
        }
    };

    const saveDav = () => {
        setWebdavConfig(dav);
        showToast("WebDAV 配置已保存");
    };

    const doDavTest = async () => {
        setWebdavConfig(dav);
        setDavTestMsg("连接中…");
        const res = await testWebdav();
        setDavTestMsg(res.message);
    };

    const doDavUpload = async () => {
        setWebdavConfig(dav);
        setBusy(true);
        try {
            const res = await exportBackupToWebdav();
            setDavLastUpload(getWebdavLastAt("upload"));
            showToast(`已备份到 WebDAV：${res.remotePath}`);
        } catch (e: any) {
            showToast(e?.message ?? "上传失败");
        }
        setBusy(false);
    };

    const doDavRestore = async () => {
        setWebdavConfig(dav);
        setBusy(true);
        try {
            const { summary } = await importBackupFromWebdav(mode);
            applyRestored(describeResumeSummary(summary));
        } catch (e: any) {
            showToast(e?.message ?? "从 WebDAV 恢复失败");
            setBusy(false);
        }
    };

    return (
        <div className="page-inner settings-page">
            <section className="settings-section">
                <h3 className="settings-section-title">外观</h3>
                <div className="settings-row">
                    <div className="settings-label">主题</div>
                    <div className="seg-tabs">
                        {(
                            [
                                { key: "dark", label: "深色" },
                                { key: "light", label: "浅色" },
                                { key: "auto", label: "跟随系统" },
                            ] as { key: ThemeSetting; label: string }[]
                        ).map((it) => (
                            <button
                                key={it.key}
                                className={`seg-tab ${themeSetting === it.key ? "active" : ""}`}
                                onClick={() => setTheme(it.key)}
                            >
                                {it.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="settings-section">
                <h3 className="settings-section-title">播放</h3>
                <div className="settings-row">
                    <div className="settings-label">默认音质</div>
                    <div className="seg-tabs">
                        {(
                            [
                                { key: "low", label: "低品" },
                                { key: "standard", label: "标准" },
                                { key: "high", label: "高品" },
                                { key: "super", label: "无损" },
                            ] as { key: IMusic.IQualityKey; label: string }[]
                        ).map((it) => (
                            <button
                                key={it.key}
                                className={`seg-tab ${quality === it.key ? "active" : ""}`}
                                onClick={() => setDefaultQuality(it.key)}
                            >
                                {it.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="settings-row">
                    <div className="settings-label">
                        记忆播放进度
                        <div className="settings-label-sub">切后台/退出后，下次从上次的位置继续</div>
                    </div>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={rememberProgress}
                            onChange={(e) => {
                                setRememberProgress(e.target.checked);
                                setConfig("rememberProgress", e.target.checked);
                            }}
                        />
                        <span className="switch-slider" />
                    </label>
                </div>
            </section>

            <section className="settings-section">
                <h3 className="settings-section-title">网络</h3>
                {native ? (
                    <div className="settings-label-sub">
                        当前为原生应用：网络请求已走原生通道（无跨域限制），无需配置伴生代理。
                    </div>
                ) : (
                    <div className="settings-row col">
                        <div className="settings-label">
                            伴生代理（可选）
                            <div className="settings-label-sub">
                                音源接口被跨域拦截、或歌曲直链需要特殊请求头时，在电脑上运行本项目
                                <code>npm run proxy</code> 并把地址填到这里（如 http://192.168.1.5:7952）
                            </div>
                        </div>
                        <div className="settings-input-row">
                            <input
                                className="text-input"
                                placeholder="http://电脑局域网IP:7952（留空不使用）"
                                value={proxyBase}
                                onChange={(e) => setProxyBaseState(e.target.value)}
                            />
                            <button
                                className="btn ghost"
                                onClick={() => {
                                    setProxyBase(proxyBase);
                                    setProxyTestMsg("已保存");
                                }}
                            >
                                保存
                            </button>
                            <button
                                className="btn ghost"
                                onClick={async () => {
                                    setProxyTestMsg("测试中…");
                                    const res = await testProxy(proxyBase);
                                    setProxyTestMsg(res.message);
                                }}
                            >
                                测试
                            </button>
                        </div>
                        {proxyTestMsg && <div className="settings-test-msg">{proxyTestMsg}</div>}
                    </div>
                )}
            </section>

            <section className="settings-section">
                <h3 className="settings-section-title">备份与恢复</h3>
                <div className="settings-label-sub settings-section-desc">
                    备份文件与 MusicFreeDesktop 互通：歌单（含「我喜欢的音乐」）、音源插件、播放队列等偏好可互相恢复。
                </div>
                {counts && (
                    <div className="backup-counts">
                        {counts.sheets} 个歌单 · {counts.songs} 首歌 · {counts.plugins} 个音源插件
                    </div>
                )}
                <div className="settings-row">
                    <div className="settings-label">恢复模式</div>
                    <select
                        className="select-input"
                        value={mode}
                        onChange={(e) => {
                            setMode(e.target.value as ResumeMode);
                            setResumeMode(e.target.value as ResumeMode);
                        }}
                    >
                        {RESUME_MODE_OPTIONS.map((it) => (
                            <option key={it.value} value={it.value}>
                                {it.label}（{it.desc}）
                            </option>
                        ))}
                    </select>
                </div>

                <div className="settings-row">
                    <button className="btn primary" onClick={doExport} disabled={busy}>
                        导出备份
                    </button>
                    <button
                        className="btn ghost"
                        onClick={() => fileRef.current?.click()}
                        disabled={busy}
                    >
                        导入备份
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: "none" }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                doImport(file);
                            }
                            e.target.value = "";
                        }}
                    />
                </div>

                <div className="settings-row col">
                    <div className="settings-label">从 URL 恢复</div>
                    <div className="settings-input-row">
                        <input
                            className="text-input"
                            placeholder="备份文件链接（http(s)://...）"
                            value={urlRestore}
                            onChange={(e) => setUrlRestore(e.target.value)}
                        />
                        <button
                            className="btn ghost"
                            onClick={doUrlRestore}
                            disabled={busy || !urlRestore.trim()}
                        >
                            恢复
                        </button>
                    </div>
                </div>

                <div className="settings-row col dav-block">
                    <div className="settings-label">
                        WebDAV 云备份
                        <div className="settings-label-sub">
                            与桌面端同一通道：填同一个服务器，把文件路径指到桌面端的
                            <code>/MusicFree/MusicFreeDesktopBackup.json</code>
                            即可互相同步。密码只保存在本机，不会写进备份文件。
                        </div>
                    </div>
                    <div className="settings-input-row">
                        <input
                            className="text-input"
                            placeholder="服务器地址，如 https://dav.jianguoyun.com/dav/"
                            value={dav.url}
                            onChange={(e) => setDav({ ...dav, url: e.target.value })}
                        />
                    </div>
                    <div className="settings-input-row">
                        <input
                            className="text-input"
                            placeholder="用户名"
                            value={dav.username}
                            onChange={(e) => setDav({ ...dav, username: e.target.value })}
                        />
                        <input
                            className="text-input"
                            type="password"
                            placeholder="密码 / 应用密码"
                            value={dav.password}
                            onChange={(e) => setDav({ ...dav, password: e.target.value })}
                        />
                    </div>
                    <div className="settings-input-row">
                        <input
                            className="text-input"
                            placeholder={`文件路径（默认 ${DEFAULT_WEBDAV_FILE_PATH}）`}
                            value={dav.filePath}
                            onChange={(e) => setDav({ ...dav, filePath: e.target.value })}
                        />
                        <button className="btn ghost" onClick={saveDav} disabled={busy}>
                            保存
                        </button>
                    </div>
                    <div className="settings-row">
                        <button className="btn ghost" onClick={doDavTest} disabled={busy}>
                            测试连接
                        </button>
                        <button
                            className="btn primary"
                            onClick={doDavUpload}
                            disabled={busy || !dav.url.trim()}
                        >
                            上传备份
                        </button>
                        <button
                            className="btn ghost"
                            onClick={doDavRestore}
                            disabled={busy || !dav.url.trim()}
                        >
                            从 WebDAV 恢复
                        </button>
                    </div>
                    {davTestMsg && <div className="settings-test-msg">{davTestMsg}</div>}
                    {davLastUpload && (
                        <div className="settings-test-msg">
                            上次上传：{new Date(davLastUpload).toLocaleString()}
                        </div>
                    )}
                </div>
            </section>

            <section className="settings-section">
                <h3 className="settings-section-title">关于</h3>
                <div className="settings-row">
                    <div className="settings-label">MusicFree Pad</div>
                    <div className="settings-label-sub">
                        {`v${__APP_VERSION__} · 插件与数据兼容 MusicFreeDesktop · 原生应用基于`}
                        {native ? " Capacitor" : " Capacitor（可打包 Android / iOS）"}
                    </div>
                </div>
            </section>
        </div>
    );
}
