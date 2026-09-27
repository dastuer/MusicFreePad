/**
 * 原生环境（Capacitor）适配层
 *
 * 浏览器里跑的是纯 Web；打包成 Android/iOS 原生应用后：
 *  - 主线程 fetch 被 CapacitorHttp 接管（无跨域限制、可带任意请求头）；
 *  - Worker 里的插件请求通过 pluginHost 的 net 通道转发到主线程原生 HTTP；
 *  - 状态栏样式由这里统一设置。
 */

export function isNative(): boolean {
    try {
        return !!(window as any).Capacitor?.isNativePlatform?.();
    } catch {
        return false;
    }
}

/** 主线程是否可用原生 HTTP（CapacitorHttp 插件已启用） */
export function hasNativeHttp(): boolean {
    if (!isNative()) {
        return false;
    }
    try {
        const Cap = (window as any).Capacitor;
        return !!Cap?.Plugins?.CapacitorHttp;
    } catch {
        return false;
    }
}

export interface INativeHttpResult {
    status: number;
    headers: Record<string, string>;
    text: string;
}

/** 主线程原生 HTTP 请求（仅在 hasNativeHttp() 时调用） */
export async function nativeHttpRequest(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}): Promise<INativeHttpResult> {
    const Cap = (window as any).Capacitor;
    const res = await Cap.Plugins.CapacitorHttp.request({
        url: options.url,
        method: options.method.toUpperCase(),
        headers: options.headers ?? {},
        data: options.body ?? undefined,
        responseType: "text",
        connectTimeout: Math.min(options.timeoutMs ?? 20000, 60000),
        readTimeout: Math.min(options.timeoutMs ?? 20000, 60000),
    });
    const headers: Record<string, string> = {};
    const rawHeaders = res.headers ?? {};
    for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    return {
        status: res.status,
        headers,
        text: typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? ""),
    };
}

/** 原生环境的状态栏 / 导航栏配色（暗色主题） */
export async function setupNativeStatusBar() {
    if (!isNative()) {
        return;
    }
    try {
        const Cap = (window as any).Capacitor;
        const StatusBar = Cap.Plugins?.StatusBar;
        if (StatusBar) {
            await StatusBar.setStyle({ style: "DARK" });
            await StatusBar.setBackgroundColor({ color: "#151515" });
        }
        const NavBar = Cap.Plugins?.NavigationBar;
        if (NavBar) {
            await NavBar.setBackgroundColor({ color: "#0c0c0c" });
        }
    } catch (e) {
        console.warn("[native] 状态栏设置失败", e);
    }
}
