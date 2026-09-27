import { useEffect, useRef, useState } from "react";
import { getCachedPlugins, getPlugins, type SerializedPlugin } from "@/core/ipc";
import {
    AUTO_SOURCE,
    getDefaultSource,
    setSessionSource,
    useGlobalSource,
} from "@/core/mediaSource";
import { IconChevronDown, IconMusic } from "./Icons";

/**
 * 全局音源切换器（只挂在顶栏，所有页面共用同一个全局音源）：
 *  - method 为当前页面需要的插件能力，决定菜单里列出哪些音源；
 *    纯本地页面传 null，不显示切换器；
 *  - 手动切换只对本次运行生效，App 重启后恢复为默认音源（音源插件页「设为默认」）；
 *  - 「自动」= 没有默认音源时按插件排序逐个降级尝试。
 */
export default function SourceSwitcher({ method }: { method?: string | null }) {
    const globalSource = useGlobalSource();
    const defaultHash = getDefaultSource();
    const [open, setOpen] = useState(false);
    const [plugins, setPlugins] = useState<SerializedPlugin[]>([]);
    const [allPlugins, setAllPlugins] = useState<SerializedPlugin[]>(getCachedPlugins);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!method) {
            return;
        }
        getPlugins().then((list) => {
            setAllPlugins(list);
            setPlugins(
                list.filter(
                    (p) =>
                        p.enabled && p.state === "Mounted" && p.supportedMethods.includes(method),
                ),
            );
        });
    }, [method]);

    // 每次展开时刷新一次，安装/停用插件后立即可见
    useEffect(() => {
        if (!open || !method) {
            return;
        }
        getPlugins(true).then((list) => {
            setAllPlugins(list);
            setPlugins(
                list.filter(
                    (p) =>
                        p.enabled && p.state === "Mounted" && p.supportedMethods.includes(method),
                ),
            );
        });
        const onDocClick = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDocClick);
        return () => document.removeEventListener("pointerdown", onDocClick);
    }, [open, method]);

    if (!method) {
        return null;
    }

    const isOverride = globalSource !== AUTO_SOURCE && globalSource !== defaultHash;
    // 全局音源不支持当前页面的能力时，取数会自动降级到其他音源（见 pickSourcePlugins）
    const unsupportedHere =
        globalSource !== AUTO_SOURCE &&
        plugins.length > 0 &&
        !plugins.some((p) => p.hash === globalSource);
    const label =
        globalSource === AUTO_SOURCE
            ? "自动"
            : (allPlugins.find((p) => p.hash === globalSource)?.name ??
              // 插件列表还没加载完，先占位，避免顶栏闪一下「已卸载音源」
              (allPlugins.length ? "已卸载音源" : "音源"));

    return (
        <div className="source-switcher" ref={rootRef}>
            <button
                className={`source-switcher-btn ${globalSource !== AUTO_SOURCE ? "active" : ""}`}
                title="音源"
                onClick={() => setOpen((v) => !v)}
            >
                <IconMusic size={13} />
                <span className="source-switcher-label">{label}</span>
                {isOverride && <span className="source-switcher-dot" title="本次运行有效" />}
                <IconChevronDown size={13} />
            </button>
            {open && (
                <div className="source-switcher-menu">
                    <div
                        className={`source-switcher-item ${
                            globalSource === AUTO_SOURCE ? "selected" : ""
                        }`}
                        onClick={() => {
                            setSessionSource(AUTO_SOURCE);
                            setOpen(false);
                        }}
                    >
                        跟随默认（自动降级）
                    </div>
                    {plugins.map((p) => (
                        <div
                            key={p.hash}
                            className={`source-switcher-item ${globalSource === p.hash ? "selected" : ""}`}
                            onClick={() => {
                                setSessionSource(p.hash);
                                setOpen(false);
                            }}
                        >
                            {p.name}
                            {p.hash === defaultHash && <span className="ss-badge">默认</span>}
                            {globalSource === p.hash && isOverride && (
                                <span className="ss-badge session">本次有效</span>
                            )}
                        </div>
                    ))}
                    {!plugins.length && (
                        <div className="source-switcher-empty">没有音源支持当前页面</div>
                    )}
                    <div className="source-switcher-hint">
                        {unsupportedHere
                            ? "当前音源不支持本页，数据来自其他音源"
                            : isOverride
                              ? "手动切换仅本次运行有效，重启后恢复默认音源"
                              : defaultHash === AUTO_SOURCE
                                ? "未设置默认音源，可在「音源插件」页设为默认"
                                : "当前使用默认音源，手动切换仅本次运行有效"}
                    </div>
                </div>
            )}
        </div>
    );
}
