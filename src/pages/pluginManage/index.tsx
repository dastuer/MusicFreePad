import { useEffect, useRef, useState } from "react";
import {
    pluginHost,
    type SerializedPlugin,
} from "@/core/ipc";
import { invalidatePluginCache } from "@/core/ipc";
import { openPrompt, showToast } from "@/core/uiAtoms";
import { useBackLayer } from "@/core/systemBack";
import { setDefaultSource, clearDefaultSource } from "@/core/mediaSource";
import { IconClose, IconDragHandle, IconPlus, IconTrash } from "@/components/base/Icons";

/**
 * 音源插件管理：
 *  - 本地文件安装 / URL 安装 / 聚合订阅源批量导入
 *  - 启用开关、设为默认（可取消）、更新、用户变量、删除、拖拽排序、详情面板
 * 插件协议与 MusicFreeDesktop / MusicFree 移动端一致（同一个插件文件都能装）。
 */

/** 复制文本到剪贴板（详情面板里点击 hash / 链接触发） */
function copyText(text: string) {
    navigator.clipboard?.writeText(text).then(
        () => showToast("已复制"),
        () => showToast("复制失败"),
    );
}

/** 音源详情底部面板：展示插件元信息、支持的能力、用户变量 */
function PluginDetailSheet({
    plugin,
    onClose,
}: {
    plugin: SerializedPlugin | null;
    onClose: () => void;
}) {
    useBackLayer(!!plugin, "plugin-detail", onClose);

    if (!plugin) {
        return null;
    }

    const vars = Array.isArray(plugin.userVariablesDef) && plugin.userVariablesDef.length
        ? plugin.userVariablesDef.map((def: any) => ({
              name: def.name ?? def.key,
              value: plugin.userVariables?.[def.key]?.trim(),
          }))
        : Object.entries(plugin.userVariables ?? {})
              .filter(([, v]) => v?.trim())
              .map(([k, v]) => ({ name: k, value: v.trim() }));

    return (
        <div className="sheet-mask" onClick={onClose}>
            <div className="add-sheet-panel plugin-detail-panel" onClick={(e) => e.stopPropagation()}>
                <div className="plugin-detail-head">
                    <div className="plugin-detail-title">
                        {plugin.name}
                        <span className="plugin-badge">v{plugin.version || "未知"}</span>
                        <span className={`plugin-badge ${plugin.state === "Mounted" ? "ok" : "err"}`}>
                            {plugin.state === "Mounted" ? "已挂载" : plugin.errorReason ?? "错误"}
                        </span>
                    </div>
                    <button className="icon-btn" onClick={onClose}>
                        <IconClose size={20} />
                    </button>
                </div>
                <div className="plugin-detail-body">
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">作者</span>
                        <span className="plugin-detail-value">{plugin.author || "未知"}</span>
                    </div>
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">平台标识</span>
                        <span className="plugin-detail-value plugin-detail-mono">{plugin.platform || "未知"}</span>
                    </div>
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">运行状态</span>
                        <span className="plugin-detail-value">
                            {plugin.state === "Mounted"
                                ? "已挂载，可正常使用"
                                : `加载失败（${plugin.errorReason ?? "未知原因"}）`}
                        </span>
                    </div>
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">启用状态</span>
                        <span className="plugin-detail-value">{plugin.enabled ? "已启用" : "已禁用"}</span>
                    </div>
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">描述</span>
                        <span className="plugin-detail-value">{plugin.description || "暂无描述"}</span>
                    </div>
                    {plugin.srcUrl && (
                        <div className="plugin-detail-row">
                            <span className="plugin-detail-label">来源链接</span>
                            <span
                                className="plugin-detail-value copyable plugin-detail-mono"
                                onClick={() => copyText(plugin.srcUrl)}
                            >
                                {plugin.srcUrl}
                            </span>
                        </div>
                    )}
                    <div className="plugin-detail-row">
                        <span className="plugin-detail-label">插件指纹</span>
                        <span
                            className="plugin-detail-value copyable plugin-detail-mono"
                            onClick={() => copyText(plugin.hash)}
                        >
                            {plugin.hash.slice(0, 16)}…{plugin.hash.slice(-8)}
                        </span>
                    </div>

                    {Array.isArray(plugin.supportedMethods) && plugin.supportedMethods.length > 0 && (
                        <div className="plugin-detail-block">
                            <div className="plugin-detail-block-title">支持的能力</div>
                            <div className="plugin-detail-tags">
                                {plugin.supportedMethods.map((m) => (
                                    <span key={m} className="plugin-detail-tag">
                                        {m}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {vars.length > 0 && (
                        <div className="plugin-detail-block">
                            <div className="plugin-detail-block-title">用户变量</div>
                            {vars.map((v) => (
                                <div key={v.name} className="plugin-detail-var">
                                    <span className="plugin-detail-var-name">{v.name}</span>
                                    <span className="plugin-detail-var-value">{v.value || "未设置"}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function PluginManagePage() {
    const [plugins, setPlugins] = useState<SerializedPlugin[]>([]);
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState(false);
    const [detail, setDetail] = useState<SerializedPlugin | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const refresh = async () => {
        const list = await pluginHost.getSerializedPlugins();
        setPlugins([...list].sort((a, b) => a.order - b.order));
        invalidatePluginCache();
    };

    useEffect(() => {
        pluginHost.setup().then(refresh);
    }, []);

    /* ---------- 拖拽排序（指针事件，与播放队列面板同款实现） ---------- */

    interface IDragRaw {
        from: number;
        startY: number;
        lastClientY: number;
    }
    const [drag, setDrag] = useState<{ from: number; target: number; dy: number } | null>(null);
    const dragRawRef = useRef<IDragRaw | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    /** 由指针位置算落点行号：按各卡片中点比较（卡片高度不完全一致，不能按固定行高除） */
    const calcTarget = (clientY: number, from: number) => {
        const listEl = listRef.current;
        if (!listEl) {
            return from;
        }
        const cards = Array.from(listEl.querySelectorAll(".plugin-card")) as HTMLElement[];
        let target = from;
        for (let i = 0; i < cards.length; i++) {
            const rect = cards[i].getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (i < from && clientY < mid) {
                target = i;
                break;
            }
            if (i > from && clientY > mid) {
                target = i;
            }
        }
        return target;
    };

    const syncDragVisual = (raw: IDragRaw) => {
        const target = calcTarget(raw.lastClientY, raw.from);
        const cards = listRef.current
            ? (Array.from(listRef.current.querySelectorAll(".plugin-card")) as HTMLElement[])
            : [];
        let dy = raw.lastClientY - raw.startY;
        if (target !== raw.from && cards[raw.from]) {
            const fromRect = cards[raw.from].getBoundingClientRect();
            const toRect = cards[target].getBoundingClientRect();
            // 跟手位移对齐目标卡片的起点，让位动画顺滑
            dy += toRect.top - fromRect.top;
        }
        setDrag({ from: raw.from, target, dy });
    };

    const onDragStart = (e: React.PointerEvent, index: number) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const raw: IDragRaw = { from: index, startY: e.clientY, lastClientY: e.clientY };
        dragRawRef.current = raw;
        syncDragVisual(raw);
    };

    const onDragMove = (e: React.PointerEvent) => {
        const raw = dragRawRef.current;
        if (!raw) {
            return;
        }
        raw.lastClientY = e.clientY;
        syncDragVisual(raw);
    };

    const onDragEnd = () => {
        const raw = dragRawRef.current;
        dragRawRef.current = null;
        const target = drag?.target ?? raw?.from ?? 0;
        if (raw && target !== raw.from) {
            const hashes = plugins.map((p) => p.hash);
            const moved = hashes.splice(raw.from, 1)[0];
            hashes.splice(target, 0, moved);
            pluginHost.setPluginOrder(hashes);
            setPlugins((prev) => {
                const next = [...prev];
                const [item] = next.splice(raw.from, 1);
                next.splice(target, 0, item);
                return next;
            });
            void refresh();
        }
        setDrag(null);
    };

    /** 渲染行内位移：拖拽行跟手，途经的行整体让位滑开 */
    const rowShiftStyle = (idx: number): React.CSSProperties | undefined => {
        if (!drag) {
            return undefined;
        }
        if (idx === drag.from) {
            return {
                transform: `translateY(${drag.dy}px)`,
                transition: "none",
                zIndex: 2,
            };
        }
        if (drag.target === drag.from) {
            return undefined;
        }
        if (drag.from < drag.target && idx > drag.from && idx <= drag.target) {
            const cards = listRef.current
                ? (Array.from(listRef.current.querySelectorAll(".plugin-card")) as HTMLElement[])
                : [];
            const h = cards[idx]?.getBoundingClientRect().height ?? 0;
            return { transform: `translateY(${-h}px)` };
        }
        if (drag.from > drag.target && idx >= drag.target && idx < drag.from) {
            const cards = listRef.current
                ? (Array.from(listRef.current.querySelectorAll(".plugin-card")) as HTMLElement[])
                : [];
            const h = cards[idx]?.getBoundingClientRect().height ?? 0;
            return { transform: `translateY(${h}px)` };
        }
        return undefined;
    };

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
        try {
            const res = await pluginHost.installPluginFromLocalFile(file);
            showToast(res.success ? `插件「${res.pluginName}」安装成功` : res.message ?? "安装失败");
            if (res.success) {
                await refresh();
            }
        } catch (e: any) {
            showToast(e?.message ?? "安装失败");
        }
        setBusy(false);
    };

    const updatePlugin = async (plugin: SerializedPlugin) => {
        if (!plugin.srcUrl) {
            return;
        }
        setBusy(true);
        const res = await pluginHost.installPluginFromUrl(plugin.srcUrl);
        showToast(res.success ? "已是最新版本" : res.message ?? "更新失败");
        await refresh();
        setBusy(false);
    };

    const setDefault = (plugin: SerializedPlugin) => {
        // 设为默认音源：持久化保存，同时全局音源立即切到它（并清掉手动切换）
        setDefaultSource(plugin.hash);
        showToast(`已把「${plugin.name}」设为默认音源，全局音源已切换`);
        invalidatePluginCache();
        setPlugins((prev) => [...prev]);
    };

    const unsetDefault = () => {
        // 取消默认音源：回到「自动」（手动选择仍优先，两者都没有才逐个降级尝试）
        clearDefaultSource();
        showToast("已取消默认音源，按插件顺序自动选择");
        invalidatePluginCache();
        setPlugins((prev) => [...prev]);
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
                    按住卡片左侧手柄可拖拽调整顺序（顺序即搜索 / 播放的尝试优先级）。
                </div>
            </div>

            <div className="plugin-list" ref={listRef}>
                {plugins.map((plugin, idx) => {
                    const isDefault = defaultHash === plugin.hash;
                    return (
                        <div
                            key={plugin.hash}
                            className={`plugin-card ${drag?.from === idx ? "dragging" : ""}`}
                            style={rowShiftStyle(idx)}
                        >
                            <div className="plugin-card-main">
                                <button
                                    className="plugin-drag-handle"
                                    title="按住拖拽排序"
                                    onPointerDown={(e) => onDragStart(e, idx)}
                                    onPointerMove={onDragMove}
                                    onPointerUp={onDragEnd}
                                    onPointerCancel={onDragEnd}
                                >
                                    <IconDragHandle size={17} />
                                </button>
                                <div className="plugin-card-body">
                                    <div className="plugin-card-title">
                                        <span className="plugin-name">{plugin.name || "未知音源"}</span>
                                        <span className="plugin-version">{plugin.version}</span>
                                        {isDefault && (
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
                            </div>
                            <div className="plugin-card-actions">
                                <button
                                    className="btn ghost small"
                                    onClick={() => setDetail(plugin)}
                                    title="查看详情"
                                >
                                    详情
                                </button>
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
                                        {isDefault ? (
                                            <button
                                                className="btn ghost small"
                                                onClick={unsetDefault}
                                                title="取消默认音源，回到按插件顺序自动选择"
                                            >
                                                取消默认
                                            </button>
                                        ) : (
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
                                    className="icon-btn danger"
                                    title="卸载"
                                    onClick={async () => {
                                        if (isDefault) {
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
                    );
                })}
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

            <PluginDetailSheet plugin={detail} onClose={() => setDetail(null)} />
        </div>
    );
}
