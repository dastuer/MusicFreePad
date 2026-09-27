/**
 * 网络辅助：伴生代理（可选）+ 媒体链接构造
 *
 * iPad 浏览器环境没有桌面端 mfs:// 自定义协议那层代理。插件的 API 请求可能被
 * CORS 拦截、媒体直链可能需要特定请求头，这里提供一个可选的伴生代理通道：
 *  - 项目自带 `npm run proxy` 起一个本地转发服务，把地址填进设置页即可；
 *  - 未配置时，插件请求直接 fetch（多数源可用），媒体直链原样交给 <audio>。
 */

import { b64urlEncode } from "./ipc";

export const PROXY_BASE_KEY = "mediaProxy.base";

export function getProxyBase(): string {
    try {
        return (localStorage.getItem(PROXY_BASE_KEY) ?? "").replace(/\/+$/, "");
    } catch {
        return "";
    }
}

export function setProxyBase(value: string) {
    const trimmed = (value ?? "").trim().replace(/\/+$/, "");
    if (trimmed) {
        localStorage.setItem(PROXY_BASE_KEY, trimmed);
    } else {
        localStorage.removeItem(PROXY_BASE_KEY);
    }
}

export interface IRelayOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

/**
 * 通过伴生代理发起一次 HTTP 请求，返回 {status, headers, text}。
 * 代理挂掉 / 未配置时抛错，由调用方决定是否回退直连。
 */
export async function relayRequest(url: string, options?: IRelayOptions) {
    const proxyBase = getProxyBase();
    if (!proxyBase) {
        throw new Error("未配置伴生代理");
    }
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error("代理请求超时")),
        options?.timeoutMs ?? 30000,
    );
    try {
        const res = await fetch(`${proxyBase}/relay`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                url,
                method: options?.method ?? "GET",
                headers: options?.headers,
                body: options?.body,
                responseType: "text",
            }),
        });
        if (!res.ok) {
            throw new Error(`代理请求失败 (${res.status})`);
        }
        const payload = await res.json();
        if (payload.error) {
            throw new Error(String(payload.error));
        }
        return {
            status: payload.status ?? 200,
            headers: payload.headers ?? {},
            text: String(payload.data ?? ""),
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 拉一段文本（插件源码 / 歌词 / 聚合源）：
 * 配了代理就先走代理，失败回退直连；没配代理直接 fetch。
 */
export async function netFetchText(url: string, timeoutMs = 30000): Promise<string> {
    if (getProxyBase()) {
        try {
            const relayed = await relayRequest(url, { timeoutMs });
            return relayed.text;
        } catch (e) {
            console.warn("[net] 代理请求失败，回退直连", e);
        }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("请求超时")), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
        if (!res.ok) {
            throw new Error(`请求失败 (${res.status})`);
        }
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 构造 <audio> 可用的播放地址：
 *  - 直链无特殊请求头：原样返回（媒体元素加载跨域资源不受 CORS 限制）；
 *  - 直链带请求头（Referer / UA / Cookie）：浏览器无法给 <audio> 塞头，
 *    配了伴生代理时走 `/media` 转发；没配就只能原样试（部分源不带头也能放）。
 */
export function buildPlayableMediaUrl(payload: {
    url: string;
    headers?: Record<string, string>;
    userAgent?: string;
}): string {
    const { url } = payload;
    const headers: Record<string, string> = { ...(payload.headers ?? {}) };
    if (payload.userAgent && !Object.keys(headers).some((h) => h.toLowerCase() === "user-agent")) {
        headers["User-Agent"] = payload.userAgent;
    }
    const needsHeaders = Object.keys(headers).length > 0;
    const proxyBase = getProxyBase();
    if (needsHeaders && proxyBase) {
        return `${proxyBase}/media?u=${b64urlEncode(url)}&h=${b64urlEncode(
            JSON.stringify(headers),
        )}`;
    }
    return url;
}

/** 测试伴生代理连通性 */
export async function testProxy(base?: string): Promise<{ ok: boolean; message: string }> {
    const target = (base ?? getProxyBase()).replace(/\/+$/, "");
    if (!target) {
        return { ok: false, message: "请先填写代理地址" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("连接超时")), 8000);
    try {
        const res = await fetch(`${target}/ping`, { signal: controller.signal });
        if (!res.ok) {
            return { ok: false, message: `代理响应异常 (${res.status})` };
        }
        const data = await res.json().catch(() => null);
        if (data?.service === "musicfree-pad-proxy") {
            return { ok: true, message: "代理连接成功" };
        }
        return { ok: false, message: "这不是 MusicFree Pad 伴生代理" };
    } catch (e: any) {
        return { ok: false, message: e?.message ?? "无法连接代理" };
    } finally {
        clearTimeout(timer);
    }
}
