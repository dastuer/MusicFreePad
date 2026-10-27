#!/usr/bin/env node
/**
 * 一键发版：改版本号 → 出正式签名包 + debug 渠道包 → Gitee 建发行版并上传 APK 附件
 * → 更新 update.json / update-debug.json → 提交推送
 *
 * 用法：
 *   export GITEE_TOKEN=<私人令牌（勾 projects 权限）>
 *   node scripts/release.mjs 1.0.1                        # 更新说明自动取最近 10 条提交
 *   node scripts/release.mjs 1.1.0 --notes "- 新增xx\n- 修复yy"
 *   node scripts/release.mjs 1.1.0 --debug                # 同时构建 debug 渠道包并上传（默认带上）
 *   node scripts/release.mjs 1.1.0 --no-debug             # 只出正式包
 *
 * debug 渠道：applicationId 带 .debug 后缀（build.gradle），与正式包共存；
 * 更新清单独立（update-debug.json），两个渠道互不提示对方的更新包。debug 包用
 * debug keystore 签名，仅供测试，不要分发给普通用户。
 *
 * 前置：已关联名为 gitee 的 remote（git@gitee.com:<user>/<repo>.git，main 分支）。
 * Gitee 上还没有该仓库时脚本会用 token 自动创建（公开仓库，raw 直链更新清单依赖它）。
 * 发版后清单经 Gitee raw 缓存（60~300s）生效，旧包启动 4s 后收到更新提示。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GRADLE_PATH = path.join(ROOT, "android/app/build.gradle");
const PKG_PATH = path.join(ROOT, "package.json");
const MANIFEST_PATH = path.join(ROOT, "update.json");
const MANIFEST_DEBUG_PATH = path.join(ROOT, "update-debug.json");

const log = (msg) => console.log(`[release] ${msg}`);
const die = (msg) => {
    console.error(`[release] ✗ ${msg}`);
    process.exit(1);
};

/* ---------- 参数 ---------- */

const args = process.argv.slice(2);
const ver = args[0];
if (!ver || !/^\d+\.\d+\.\d+$/.test(ver)) {
    die("用法：node scripts/release.mjs <版本号> [--notes \"- 更新说明\"]，版本号形如 1.0.1");
}
const WITH_DEBUG = !args.includes("--no-debug");
const notesIdx = args.indexOf("--notes");
let notes =
    notesIdx >= 0 && args[notesIdx + 1]
        ? args[notesIdx + 1].replace(/\\n/g, "\n")
        : execFileSync("git", ["log", "--pretty=format:- %s", "-10"], { cwd: ROOT }).toString();

const token = process.env.GITEE_TOKEN;
if (!token) {
    die("缺少 GITEE_TOKEN 环境变量（Gitee 私人令牌，权限勾 projects）");
}

/* ---------- Gitee remote 解析 ---------- */

const giteeUrl = execFileSync("git", ["remote", "get-url", "gitee"], { cwd: ROOT })
    .toString()
    .trim();
const ownerRepo = giteeUrl.match(/gitee\.com[:/](.+?)(?:\.git)?$/)?.[1];
if (!ownerRepo) {
    die(`无法从 gitee remote 解析仓库：${giteeUrl}`);
}

/* ---------- 1. 版本号两处联动（幂等：中断重跑时已是目标版本则跳过） ----------
 * package.json 的 version 经 vite define 注入为 __APP_VERSION__（backup/pluginWorker/
 * 设置页都读它），build.gradle 的 versionCode/versionName 是原生包的权威版本。 */

const gradle = fs.readFileSync(GRADLE_PATH, "utf8");
const currentCode = Number(gradle.match(/versionCode (\d+)/)?.[1]);
const currentVerName = gradle.match(/versionName "([^"]*)"/)?.[1];
const applicationId = gradle.match(/applicationId "([^"]*)"/)?.[1];
if (!currentCode || !currentVerName || !applicationId) {
    die("build.gradle 里找不到 versionCode / versionName / applicationId");
}
const nextCode = currentVerName === ver ? currentCode : currentCode + 1;
if (currentVerName !== ver) {
    fs.writeFileSync(
        GRADLE_PATH,
        gradle
            .replace(/versionCode \d+/, `versionCode ${nextCode}`)
            .replace(/versionName "[^"]*"/, `versionName "${ver}"`),
    );

    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
    pkg.version = ver;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
}
log(`版本号 → versionCode ${nextCode} / versionName ${ver}（gradle、package.json）`);

/* ---------- 2. 构建前端 + 同步 WebView 资源 + 出正式/调试签名包 ---------- */

log("构建前端（tsc + vite build）…");
execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
log("同步 WebView 资源（cap copy android）…");
execFileSync("npx", ["cap", "copy", "android"], { cwd: ROOT, stdio: "inherit" });

const gradlew = path.join(ROOT, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
const env = { ...process.env };
if (process.platform === "darwin") {
    try {
        env.JAVA_HOME = execFileSync("/usr/libexec/java_home", []).toString().trim();
    } catch {
        // 没 java_home 就退回继承的 JAVA_HOME / PATH
    }
}
const gradleTasks = WITH_DEBUG ? ["assembleRelease", "assembleDebug"] : ["assembleRelease"];
log(`开始 ${gradleTasks.join(" + ")}（几分钟，输出在 android/ 目录）…`);
const build = spawnSync(gradlew, gradleTasks, {
    cwd: path.join(ROOT, "android"),
    stdio: "inherit",
    env,
});
if (build.status !== 0) {
    die("gradle 出包失败");
}
const apkSrc = path.join(ROOT, "android/app/build/outputs/apk/release/app-release.apk");
if (!fs.existsSync(apkSrc)) {
    die(`找不到产物：${apkSrc}`);
}
const apkName = `MusicFreePad-${ver}.apk`;
const apkPath = path.join(os.tmpdir(), apkName);
fs.copyFileSync(apkSrc, apkPath);
log(`签名包已产出：${apkName}（${(fs.statSync(apkPath).size / 1024 / 1024).toFixed(1)} MB）`);

// debug 渠道包：applicationId 带 .debug 后缀 + debug keystore 签名，可与正式包共存
let debugApkPath = null;
let debugApkName = null;
if (WITH_DEBUG) {
    const debugSrc = path.join(ROOT, "android/app/build/outputs/apk/debug/app-debug.apk");
    if (!fs.existsSync(debugSrc)) {
        die(`找不到产物：${debugSrc}`);
    }
    debugApkName = `MusicFreePad-${ver}-debug.apk`;
    debugApkPath = path.join(os.tmpdir(), debugApkName);
    fs.copyFileSync(debugSrc, debugApkPath);
    log(`debug 包已产出：${debugApkName}（${(fs.statSync(debugApkPath).size / 1024 / 1024).toFixed(1)} MB）`);
}

/* ---------- 3. Gitee 仓库（缺则建）+ 建发行版 + 上传附件 ---------- */

async function giteeApi(pathname, options = {}) {
    const url = new URL(`https://gitee.com/api/v5${pathname}`);
    url.searchParams.set("access_token", token);
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Gitee API ${res.status}：${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
}

// raw 直链更新清单要求仓库公开可匿名访问；仓库不存在时自动创建
try {
    await giteeApi(`/repos/${ownerRepo}`);
    log(`Gitee 仓库已存在：${ownerRepo}`);
} catch (e) {
    if (!/404/.test(String(e.message))) {
        die(`检查 Gitee 仓库失败：${e.message}`);
    }
    const [owner] = ownerRepo.split("/");
    const repoName = ownerRepo.split("/")[1];
    log(`Gitee 仓库不存在，自动创建公开仓库：${ownerRepo} …`);
    await giteeApi("/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: repoName,
            owner: owner,
            private: false,
            has_issues: true,
            description: "MusicFree Pad 版 - 大屏音乐播放器",
        }),
    });
    log("仓库已创建（首次 push 前网页上无需再做任何配置）");
}

let release;
try {
    release = await giteeApi(`/repos/${ownerRepo}/releases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            tag_name: `v${ver}`,
            name: `v${ver}`,
            body: notes,
            target_commitish: "main",
        }),
    });
} catch (e) {
    die(`创建发行版失败（tag v${ver} 可能已存在）：${e.message}`);
}
log(`发行版已创建：v${ver}（id ${release.id}）`);

async function uploadApk(apkFile, name) {
    const form = new FormData();
    form.append(
        "file",
        new Blob([fs.readFileSync(apkFile)], {
            type: "application/vnd.android.package-archive",
        }),
        name,
    );
    const uploaded = await giteeApi(
        `/repos/${ownerRepo}/releases/${release.id}/attach_files`,
        { method: "POST", body: form },
    );
    log(`附件已上传：${uploaded.browser_download_url}`);
    return uploaded.browser_download_url;
}

const apkUrl = await uploadApk(apkPath, apkName);

let debugApkUrl = null;
if (WITH_DEBUG) {
    debugApkUrl = await uploadApk(debugApkPath, debugApkName);
}

/* ---------- 4. 更新清单 update.json / update-debug.json ---------- */

const publishedAt = new Date().toISOString().slice(0, 10);
const manifest = {
    versionCode: nextCode,
    versionName: ver,
    changelog: notes,
    apkUrl,
    publishedAt,
    // 包名钉死在清单里：客户端与本机包名精确比对，渠道错配直接拒绝更新
    packageName: applicationId,
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

if (WITH_DEBUG) {
    const debugManifest = {
        versionCode: nextCode,
        versionName: `${ver}-debug`,
        changelog: notes,
        apkUrl: debugApkUrl,
        publishedAt,
        packageName: `${applicationId}.debug`,
    };
    fs.writeFileSync(MANIFEST_DEBUG_PATH, JSON.stringify(debugManifest, null, 2) + "\n");
}

/* ---------- 5. 提交并推送 ---------- */

execFileSync(
    "git",
    ["add", "android/app/build.gradle", "package.json", "update.json", "update-debug.json"],
    { cwd: ROOT },
);
// 中断重跑时清单/版本号可能已无变化：无 diff 就跳过提交，推送照常
const committed = spawnSync(
    "git",
    ["commit", "-m", `发版 v${ver}（versionCode ${nextCode}）`],
    { cwd: ROOT },
);
if (committed.status === 0) {
    log("已提交版本号与清单变更");
} else {
    log("版本号与清单无变化，跳过提交");
}
execFileSync("git", ["push", "gitee", "main"], { cwd: ROOT });
log("已推送到 gitee main");

console.log(`
[release] ✓ v${ver} 发版完成
  正式渠道清单：https://gitee.com/${ownerRepo}/raw/main/update.json
  debug 渠道清单：https://gitee.com/${ownerRepo}/raw/main/update-debug.json（Gitee 缓存 60~300s 后生效）
  旧包启动 4s 后收到更新提示，或设置 → 关于 → 检查更新`);
