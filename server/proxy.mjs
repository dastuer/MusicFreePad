/**
 * MusicFree Pad 伴生代理（可选组件）
 *
 * iPad 浏览器环境没有桌面端 mfs:// 协议的代理能力：
 *  - 插件的音源接口请求可能被 CORS 拦截；
 *  - 部分歌曲直链需要 Referer / User-Agent / Cookie 才能播放，<audio> 无法带请求头。
 *
 * 在与 iPad 同一局域网的电脑上运行：`npm run proxy`（默认端口 7952），
 * 然后在 Pad 应用「设置 → 网络」里填 http://<电脑IP>:7952 即可：
 *  - POST /relay  转发插件 API 请求（JSON：url/method/headers/body）
 *  - GET  /media?u=<b64url>&h=<b64url(json headers)>  转发媒体流（透传 Range）
 *  - GET  /ping   健康检查
 */

import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import os from "node:os";

const PORT = Number(process.env.PORT || 7952);
const HOST = process.env.HOST || "0.0.0.0";

const b64urlDecode = (s) =>
    Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, X-Requested-With");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
}

function readBody(req, limit = 32 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error("请求体过大"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

/** 用原始 socket 转发（可携带任意 Host/Referer 等头，不受 Node fetch 限制），自动跟随重定向 */
async function rawRequest({ protocol, host, port, path, method, headers, body, timeoutMs = 30000 }) {
    let target = { protocol, host, port, path, method, headers, body };
    for (let redirects = 0; redirects < 6; redirects += 1) {
        const upstream = await singleRequest(target);
        const location = upstream.headers["location"];
        if (!location || ![301, 302, 303, 307, 308].includes(upstream.status)) {
            return upstream;
        }
        const portShown =
            (target.protocol === "https:" && target.port === 443) ||
            (target.protocol === "http:" && target.port === 80)
                ? ""
                : `:${target.port}`;
        const next = new URL(
            location,
            `${target.protocol}//${target.host}${portShown}${target.path}`,
        );
        const parsed = parseTargetUrl(next.href);
        const nextMethod = upstream.status === 303 ? "GET" : target.method;
        target = {
            ...parsed,
            method: nextMethod,
            headers: target.headers,
            body: nextMethod === "GET" ? undefined : target.body,
        };
    }
    throw new Error("重定向次数过多");
}

function singleRequest({ protocol, host, port, path, method, headers, body, timeoutMs = 30000 }) {
    return new Promise((resolve, reject) => {
        const isHttps = protocol === "https:";
        const onConnect = () => {
            let header = `${method} ${path} HTTP/1.1\r\n`;
            const mergedHeaders = {
                Host: host,
                Connection: "close",
                Accept: "*/*",
                ...headers,
            };
            if (body && !mergedHeaders["Content-Length"] && !mergedHeaders["content-length"]) {
                mergedHeaders["Content-Length"] = Buffer.byteLength(body);
            }
            for (const [k, v] of Object.entries(mergedHeaders)) {
                if (v === undefined || v === null) continue;
                header += `${k}: ${v}\r\n`;
            }
            header += "\r\n";
            socket.write(header);
            if (body) {
                socket.write(body);
            }
        };
        // https 上游必须走 TLS（servername 供 SNI 与证书校验），否则服务端按明文请求拒绝
        const socket = isHttps
            ? tls.connect({ host, port, servername: host }, onConnect)
            : net.connect({ host, port }, onConnect);

        const chunks = [];
        let buffer = Buffer.alloc(0);
        let headerEnd = -1;
        let statusLine = "";
        let responseHeaders = {};
        let chunked = false;
        let done = false;

        const timer = setTimeout(() => {
            if (!done) {
                socket.destroy(new Error("上游请求超时"));
            }
        }, timeoutMs);

        socket.on("data", (c) => {
            buffer = Buffer.concat([buffer, c]);
            if (headerEnd < 0) {
                const idx = buffer.indexOf("\r\n\r\n");
                if (idx >= 0) {
                    headerEnd = idx;
                    const headerText = buffer.slice(0, idx).toString("utf-8");
                    const lines = headerText.split("\r\n");
                    statusLine = lines[0];
                    responseHeaders = {};
                    for (const line of lines.slice(1)) {
                        const ci = line.indexOf(":");
                        if (ci > 0) {
                            responseHeaders[line.slice(0, ci).trim().toLowerCase()] =
                                line.slice(ci + 1).trim();
                        }
                    }
                    chunked = /chunked/i.test(responseHeaders["transfer-encoding"] ?? "");
                    // 逐跳头不透传
                    delete responseHeaders["transfer-encoding"];
                    delete responseHeaders.connection;
                    delete responseHeaders["content-encoding"];
                }
            }
        });

        socket.on("close", () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (headerEnd < 0) {
                reject(new Error("上游无响应"));
                return;
            }
            let body = buffer.slice(headerEnd + 4);
            // 简单处理 chunked：Node 关闭连接时已收到完整数据，手动解 chunk
            if (body.length && chunked) {
                body = dechunk(body);
            }
            resolve({ statusLine, status: parseInt(statusLine.split(" ")[1] ?? "502", 10), headers: responseHeaders, body });
        });

        socket.on("error", (e) => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                reject(e);
            }
        });
    });
}

function dechunk(buf) {
    const out = [];
    let offset = 0;
    while (offset < buf.length) {
        const lineEnd = buf.indexOf("\r\n", offset);
        if (lineEnd < 0) break;
        const size = parseInt(buf.slice(offset, lineEnd).toString("ascii").split(";")[0], 16);
        if (!Number.isFinite(size) || size === 0) break;
        out.push(buf.slice(lineEnd + 2, lineEnd + 2 + size));
        offset = lineEnd + 2 + size + 2;
    }
    return Buffer.concat(out);
}

function parseTargetUrl(url) {
    const parsed = new URL(url);
    const port =
        parsed.port ||
        (parsed.protocol === "https:" ? 443 : 80);
    return {
        protocol: parsed.protocol,
        host: parsed.hostname,
        port: Number(port),
        path: parsed.pathname + parsed.search,
    };
}

const server = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
        if (url.pathname === "/ping") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ service: "musicfree-pad-proxy", ok: true }));
            return;
        }

        if (url.pathname === "/relay" && req.method === "POST") {
            const raw = (await readBody(req)).toString("utf-8");
            const payload = JSON.parse(raw);
            const { url: targetUrl, method = "GET", headers = {}, body, responseType = "text" } = payload;
            if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
                throw new Error("url 必须是 http(s) 链接");
            }
            const target = parseTargetUrl(targetUrl);
            const forwardHeaders = { ...headers };
            delete forwardHeaders.host;
            delete forwardHeaders.Host;
            const upstream = await rawRequest({
                ...target,
                method,
                headers: forwardHeaders,
                body: body ? Buffer.from(String(body), "utf-8") : undefined,
            });
            const isBase64 = responseType === "base64";
            const data = isBase64 ? upstream.body.toString("base64") : upstream.body.toString("utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: upstream.status,
                    statusText: upstream.statusLine.split(" ").slice(2).join(" "),
                    headers: upstream.headers,
                    encoding: isBase64 ? "base64" : "text",
                    data,
                }),
            );
            return;
        }

        if (url.pathname === "/media" && req.method === "GET") {
            const u = url.searchParams.get("u");
            const h = url.searchParams.get("h");
            if (!u) {
                throw new Error("缺少 u 参数");
            }
            const targetUrl = b64urlDecode(u);
            const extraHeaders = h ? JSON.parse(b64urlDecode(h)) : {};
            const target = parseTargetUrl(targetUrl);
            const forwardHeaders = { ...extraHeaders };
            // 透传 Range（流媒体拖动进度必需）
            if (req.headers.range) {
                forwardHeaders.Range = req.headers.range;
            }
            // 媒体流可能很大：直接把上游响应管道回客户端
            const upstream = await rawRequest({ ...target, method: "GET", headers: forwardHeaders });
            const outHeaders = { ...upstream.headers };
            if (!outHeaders["accept-ranges"]) {
                outHeaders["accept-ranges"] = "bytes";
            }
            res.writeHead(upstream.status >= 200 && upstream.status < 400 ? upstream.status : 502, outHeaders);
            res.end(upstream.body);
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    } catch (e) {
        console.error("[proxy]", req.method, url.pathname, e?.message ?? e);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e?.message ?? String(e) }));
    }
});

// 局域网可访问的提示
server.listen(PORT, HOST, () => {
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const list of Object.values(ifaces)) {
        for (const it of list ?? []) {
            if (it.family === "IPv4" && !it.internal) {
                ips.push(it.address);
            }
        }
    }
    console.log("MusicFree Pad 伴生代理已启动");
    console.log(`  本机:   http://localhost:${PORT}`);
    for (const ip of ips) {
        console.log(`  局域网: http://${ip}:${PORT}   <- 把这个地址填进 Pad 应用设置`);
    }
});
