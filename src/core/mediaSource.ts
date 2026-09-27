import { atom, getDefaultStore, useAtomValue } from "jotai";
import type { SerializedPlugin } from "./ipc";

/**
 * 全局统一音源：
 *  - 默认音源（defaultPluginHash）持久化到 localStorage，由插件管理页「设为默认」维护；
 *    设置后全局音源立即切换为该音源。
 *  - 手动切换（顶栏的音源切换器）只改内存里的会话覆盖，整个 App 立即统一切到新音源，
 *    下次 App 关闭后自然失效，重新恢复为默认音源。
 *  - 都没有时为「自动」：按插件管理页的排序（默认音源优先）逐个降级尝试。
 */

export const AUTO_SOURCE = "auto";

const DEFAULT_KEY = "defaultPluginHash";

/** 本次运行的手动选择。只在内存里，App 关闭即消失。 */
let sessionSource: string | null = null;

/** 旧版按页面存音源（pageSource.<page>），统一后作废，启动时清掉。 */
function cleanupLegacyPageSources() {
    try {
        const dead: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("pageSource.")) {
                dead.push(key);
            }
        }
        dead.forEach((key) => localStorage.removeItem(key));
    } catch {
        // ignore
    }
}
cleanupLegacyPageSources();

export function getDefaultSource(): string {
    return localStorage.getItem(DEFAULT_KEY) || AUTO_SOURCE;
}

/** 当前生效的全局音源：本次手动选择 > 默认音源 > 自动 */
export function getGlobalSource(): string {
    return sessionSource ?? getDefaultSource();
}

/**
 * 手动切换全局音源（仅本次运行有效）。
 * 传 AUTO / 空值等于清除手动选择，回到默认音源。
 */
export function setSessionSource(hash?: string | null) {
    if (!hash || hash === AUTO_SOURCE || hash === getDefaultSource()) {
        sessionSource = null;
    } else {
        sessionSource = hash;
    }
    syncAtom();
}

/** 设置默认音源：持久化，并让全局音源立即切到它（清掉本次的手动选择）。 */
export function setDefaultSource(hash: string) {
    if (hash && hash !== AUTO_SOURCE) {
        localStorage.setItem(DEFAULT_KEY, hash);
    } else {
        localStorage.removeItem(DEFAULT_KEY);
    }
    sessionSource = null;
    syncAtom();
}

/** 清除默认音源：全局音源回到「自动」。 */
export function clearDefaultSource() {
    localStorage.removeItem(DEFAULT_KEY);
    syncAtom();
}

/** ---------- 让所有页面 / 切换器实时同步 ---------- */

export const globalSourceAtom = atom<string>(getGlobalSource());

function syncAtom() {
    getDefaultStore().set(globalSourceAtom, getGlobalSource());
}

/** React 侧订阅当前全局音源 */
export function useGlobalSource(): string {
    return useAtomValue(globalSourceAtom);
}

/** ---------- 音源能力筛选 ---------- */

/**
 * 按插件方法挑出可用的音源（已启用且挂载），全局音源排最前：
 *  - 「自动」：全部可用音源，按插件管理页排序（默认音源优先）逐个降级；
 *  - 指定音源：只返回该音源 —— 它挂了就报错，由用户决定要不要换；
 *  - 指定音源不具备该能力 / 已卸载停用：视为没得选，退回「自动」，
 *    避免全局切到一个功能不全的音源后聚合页整个空白。
 * 传 item（歌单 / 专辑 / 歌手详情页）时：全局音源失败后，先试与该条目同平台的音源，
 * 再试其余音源 —— 详情内容本身属于条目的平台，这样跨平台打开旧条目也不会死路。
 */
export function pickSourcePlugins(
    plugins: SerializedPlugin[],
    method: string,
    sourceHash: string,
    item?: { platform?: string } | null,
) {
    const capable = plugins.filter(
        (p) => p.enabled && p.state === "Mounted" && p.supportedMethods.includes(method),
    );
    const chosen =
        sourceHash && sourceHash !== AUTO_SOURCE
            ? capable.filter((p) => p.hash === sourceHash)
            : [];
    if (!item?.platform) {
        return chosen.length ? chosen : capable;
    }
    const samePlatform = capable.filter(
        (p) => p.platform === item.platform && p.hash !== sourceHash,
    );
    const others = capable.filter(
        (p) => p.platform !== item.platform && p.hash !== sourceHash,
    );
    return [...chosen, ...samePlatform, ...others];
}
