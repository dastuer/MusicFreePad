import { useEffect, useRef, useState } from "react";
import {
    pluginHost,
    type SerializedPlugin,
} from "@/core/ipc";
import { invalidatePluginCache } from "@/core/ipc";
import { openPrompt, showToast } from "@/core/uiAtoms";
import { setDefaultSource, clearDefaultSource } from "@/core/mediaSource";
import { IconPlus, IconTrash } from "@/components/base/Icons";

/**
 * 音源插件管理：
 *  - 本地文件安装 / URL 安装 / 聚合订阅源批量导入
 *  - 启用开关、设为默认、更新、用户变量、删除、排序
 * 插件协议与 MusicFreeDesktop / MusicFree 移动端一致（同一个插件文件都能装）。
 */
export default function PluginManagePage() {
    const [plugins, setPlugins] = useState<SerializedPlugin[]>([]);
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const refresh = async () => {
        const list = await pluginHost.getSerializedPlugins();
        setPlugins([...list].sort((a, b) => a.order - b.order));
        invalidatePluginCache();
    };

    useEffect(() => {
        pluginHost.setup().then(refresh);
    }, []);

    const enabled = plugins.filter((p) => p.state === "Mounted" && p.enabled);

    const installFromUrl = async () => {
        const target = url.trim();
        if (!target) {
            return;
        }
        setBusy(true);
        const res = await pluginHost.installPluginFromUrl(target);
        if (res.success) {
            showToast(`插件「${res.pluginName}」安装成功`);
            setUrl("");
            await refresh();
        } else if (res.errorCode === "IS_PLUGIN_INDEX") {
            try {
                const result = await pluginHost.importPluginIndex(target);
                showToast(
                    `聚合源导入完成：新增 ${result.installed}，更新 ${result.updated}，未变 ${result.unchanged}` +
                        (result.failed.length ? `，失败 ${result.failed.length}` : ""),
                    4000,
                );
                setUrl("");
                await refresh();
            } catch (e: any) {
                showToast(e?.message ?? "聚合源导入失败");
            }
        } else {
            showToast(res.message ?? "安装失败");
        }
        setBusy(false);
    };

    const installFromFile = async (file: File) => {
        setBusy(true);
        const res = await pluginHost.installPluginFromLocalFile(file);
        if (res.success) {
            showToast(`插件「${res.pluginName}」安装成功`);
            await refresh();
        } else {
            showToast(res.message ?? "安装失败");
        }
        setBusy(false);
    };

    const updatePlugin = async (plugin: SerializedPlugin) => {
        if (!plugin.srcUrl) {
            showToast("本地安装的插件没有来源链接，无法在线更新");
            return;
        }
        setBusy(true);
        const code = await fetch(plugin.srcUrl)
            .then((r) => r.text())
            .catch(() => null);
        if (!code) {
            showToast("下载插件源失败");
            setBusy(false);
            return;
        }
        const result = await pluginHost.installOrUpdate(code);
        showToast(
            result.status === "updated"
                ? `「${result.name}」已更新`
                : result.status === "unchanged"
                  ? `「${result.name}」已是最新`
                  : result.status === "installed"
                    ? `「${result.name}」安装成功`
                    : result.reason ?? "更新失败",
        );
        await refresh();
        setBusy(false);
    };

    const setDefault = (plugin: SerializedPlugin) => {
        // 设为默认音源：持久化保存，同时全局音源立即切到它（并清掉本次的手动切换）
        setDefaultSource(plugin.hash);
        showToast(`已把「${plugin.name}」设为默认音源，全局音源已切换`);
        invalidatePluginCache();
        setPlugins((prev) => [...prev]);
    };

    const move = async (plugin: SerializedPlugin, dir: -1 | 1) => {
        const hashes = plugins.map((p) => p.hash);
        const idx = hashes.indexOf(plugin.hash);
        const swap = idx + dir;
        if (swap < 0 || swap >= hashes.length) {
            return;
        }
        [hashes[idx], hashes[swap]] = [hashes[swap], hashes[idx]];
        pluginHost.setPluginOrder(hashes);
        await refresh();
    };

    const defaultHash = localStorage.getItem("defaultPluginHash");

    return (
        <div className="page-inner plugin-manage">
            <div className="plugin-install-card">
                <div className="plugin-install-row">
                    <input
                        className="text-input"
                        placeholder="粘贴插件链接或聚合订阅源链接（https://...）"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                installFromUrl();
                            }
                        }}
                    />
                    <button className="btn primary" onClick={installFromUrl} disabled={busy || !url.trim()}>
                        安装
                    </button>
                    <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                        <IconPlus size={15} />
                        <span>本地文件</span>
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".js,text/javascript"
                        style={{ display: "none" }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                installFromFile(file);
                            }
                            e.target.value = "";
                        }}
                    />
                </div>
                <div className="plugin-install-hint">
                    兼容 MusicFree 移动端 / 桌面端的音源插件（.js 文件）；桌面端备份里带的插件也会在恢复时自动装好。
                </div>
            </div>

            <div className="plugin-list">
                {plugins.map((plugin, idx) => (
                    <div key={plugin.hash} className="plugin-card">
                        <div className="plugin-card-main">
                            <div className="plugin-card-title">
                                <span className="plugin-name">{plugin.name || "未知音源"}</span>
                                <span className="plugin-version">{plugin.version}</span>
                                {defaultHash === plugin.hash && (
                                    <span className="plugin-badge">默认音源</span>
                                )}
                                {plugin.state === "Error" && (
                                    <span className="plugin-badge error">
                                        {plugin.errorReason === "VersionNotMatch"
                                            ? "版本不满足"
                                            : "解析失败"}
                                    </span>
                                )}
                            </div>
                            <div className="plugin-card-meta">
                                {plugin.author && <span>{plugin.author}</span>}
                                {plugin.description && <span> · {plugin.description}</span>}
                            </div>
                            {plugin.userVariablesDef?.length > 0 && (
                                <div className="plugin-card-vars">
                                    用户变量：
                                    {plugin.userVariablesDef
                                        .map((v: any) => v.name ?? v.key)
                                        .join("、")}
                                </div>
                            )}
                        </div>
                        <div className="plugin-card-actions">
                            <label className="switch" title={plugin.enabled ? "禁用" : "启用"}>
                                <input
                                    type="checkbox"
                                    checked={plugin.enabled}
                                    onChange={(e) => {
                                        pluginHost.setPluginEnabled(plugin.hash, e.target.checked);
                                        refresh();
                                    }}
                                />
                                <span className="switch-slider" />
                            </label>
                            {plugin.state === "Mounted" && (
                                <>
                                    {defaultHash !== plugin.hash && (
                                        <button className="btn ghost small" onClick={() => setDefault(plugin)}>
                                            设为默认
                                        </button>
                                    )}
                                    {plugin.srcUrl && (
                                        <button
                                            className="btn ghost small"
                                            onClick={() => updatePlugin(plugin)}
                                            disabled={busy}
                                        >
                                            更新
                                        </button>
                                    )}
                                    {(plugin.userVariablesDef?.length ?? 0) > 0 && (
                                        <button
                                            className="btn ghost small"
                                            onClick={() => {
                                                const defs = plugin.userVariablesDef;
                                                openPrompt({
                                                    title: `编辑 ${plugin.name} 用户变量`,
                                                    placeholder:
                                                        defs
                                                            .map((v: any) => v.key)
                                                            .join("=值 多个用换行，格式 key=value"),
                                                    defaultValue: Object.entries(
                                                        plugin.userVariables,
                                                    )
                                                        .map(([k, v]) => `${k}=${v}`)
                                                        .join("\n"),
                                                    confirmText: "保存",
                                                    onConfirm: (raw) => {
                                                        const vars: Record<string, string> = {};
                                                        raw
                                                            .split("\n")
                                                            .map((l) => l.trim())
                                                            .filter(Boolean)
                                                            .forEach((line) => {
                                                                const eq = line.indexOf("=");
                                                                if (eq > 0) {
                                                                    vars[line.slice(0, eq).trim()] =
                                                                        line.slice(eq + 1).trim();
                                                                }
                                                            });
                                                        pluginHost.setUserVariables(plugin.hash, vars);
                                                        showToast("用户变量已保存");
                                                    },
                                                });
                                            }}
                                        >
                                            变量
                                        </button>
                                    )}
                                </>
                            )}
                            <button
                                className="btn ghost small"
                                disabled={idx === 0}
                                onClick={() => move(plugin, -1)}
                            >
                                ↑
                            </button>
                            <button
                                className="btn ghost small"
                                disabled={idx === plugins.length - 1}
                                onClick={() => move(plugin, 1)}
                            >
                                ↓
                            </button>
                            <button
                                className="icon-btn danger"
                                title="卸载"
                                onClick={async () => {
                                    if (defaultHash === plugin.hash) {
                                        clearDefaultSource();
                                    }
                                    await pluginHost.uninstallPlugin(plugin.hash);
                                    showToast("插件已卸载");
                                    refresh();
                                }}
                            >
                                <IconTrash size={16} />
                            </button>
                        </div>
                    </div>
                ))}
                {!plugins.length && (
                    <div className="page-empty">
                        <div>还没有安装音源插件</div>
                        <div className="page-empty-sub">
                            在上方粘贴插件链接安装，或从桌面端备份中恢复
                        </div>
                    </div>
                )}
            </div>

            <div className="plugin-enabled-count">
                已启用 {enabled.length} / {plugins.length} 个音源
            </div>
        </div>
    );
}
