# 应用检查更新

App 内置检查更新功能：每次启动自动静默检查（延后 4 秒）+ 设置页「关于 → 检查更新」手动触发。发现新版本后弹面板展示更新日志，下载 APK（带进度、断点续传），拉起系统安装器完成升级。

## 渠道隔离（debug / 正式）

| | 正式渠道 | debug 渠道 |
|---|---|---|
| 包名 | `com.huah.musicfree.pad` | `com.huah.musicfree.pad.debug`（applicationIdSuffix） |
| versionName | `1.0.1` | `1.0.1-debug`（versionNameSuffix） |
| 签名 | `android/keystore.properties` 指定的正式签名 | 机器 debug keystore |
| 更新清单 | `update.json` | `update-debug.json` |
| APK 命名 | `MusicFreePad-1.0.1.apk` | `MusicFreePad-1.0.1-debug.apk` |

隔离三层，缺一不可：

1. **包名后缀**（`android/app/build.gradle` 的 buildTypes）：debug 包与正式包可共存，数据互不可见；
2. **独立清单**：JS 侧读原生包名（`UpdatePlugin.getAppVersion` 返回 `packageName`），`.debug` 结尾拉 `update-debug.json`，否则拉 `update.json`——两个渠道互不提示对方的更新包；
3. **清单 packageName 硬校验**（`src/core/appUpdate.ts` 的 `assertSamePackage`）：清单里的 `packageName` 字段必须与本机包名精确一致，否则直接拒绝更新——清单 URL 配错也不会把别的应用装进来。发版脚本写清单时自动填对应渠道的包名。

签名文件不入库：`android/keystore.properties` + `android/app/musicfree-pad.keystore`（.gitignore 已忽略；钥匙与 MusicFreeHy 同一把）。

## 数据源：Gitee 公开仓库 `huaihui/MusicFreePad`

客户端只做只读 GET，零 token、零 API 调用（不走 API 就没有限流问题）：

| 内容 | 存放位置 | 访问方式 |
|---|---|---|
| 版本清单 | 仓库根目录 | raw 直链：`https://gitee.com/huaihui/MusicFreePad/raw/main/update.json`（302 → raw.giteeusercontent.com，客户端手动跟随） |
| 安装包 APK | Release 附件 | 直链：`https://gitee.com/huaihui/MusicFreePad/releases/download/{tag}/{文件名}` |

- raw 有服务端缓存（60~300 秒），发版后清单最多约 5 分钟全网生效
- Release 附件限制：单文件 ≤ 100MB、单仓库附件总量 1GB，满了记得删旧版本附件
- 清单 URL 写死在 `src/core/appUpdate.ts` 顶部常量，换仓库时改那里

## 清单字段

```json
{
  "versionCode": 2,
  "versionName": "1.0.1",
  "changelog": "- 新增xxx\n- 修复xxx",
  "apkUrl": "https://gitee.com/huaihui/MusicFreePad/releases/download/v1.0.1/MusicFreePad-1.0.1.apk",
  "publishedAt": "2026-10-28",
  "packageName": "com.huah.musicfree.pad",
  "minVersionCode": 1
}
```

- `versionCode`：整数，更新判断的唯一权威，每次发版 +1
- `versionName`：展示用；versionCode 相同时客户端会比较它兜底
- `packageName`：渠道硬校验字段（必填）
- `minVersionCode`：可选强制更新门槛，低于它的本机版本面板不可关闭

## 日常发版（一键脚本）

```bash
export GITEE_TOKEN=<私人令牌，权限勾 projects>     # 只在当前终端有效即可
node scripts/release.mjs 1.0.2                     # 更新说明自动取最近 10 条提交
node scripts/release.mjs 1.0.2 --notes "- 新增xx\n- 修复yy"   # 自定义说明
node scripts/release.mjs 1.0.2 --no-debug          # 只出正式包（默认双包）
```

脚本自动完成：版本号两处联动（build.gradle versionCode+1 / versionName、package.json——前端统一读 `__APP_VERSION__`）→ 前端构建 + `cap copy android` → `assembleRelease + assembleDebug` → Gitee 建发行版（仓库不存在时自动创建公开仓库）+ 上传双包附件 → 按附件直链重写 `update.json` / `update-debug.json` → 提交推送 gitee main。中断重跑安全（版本号幂等、无变化跳过提交）。

发版后记得把 main 也推一份到 GitHub（`git push origin main`），并可用 `gh release create` 同步一份 GitHub Release（按需）。

## 行为细节

- **忽略此版本**：静默检查不再提示该 versionCode；手动检查仍会弹出
- **稍后再说**：仅关面板；下载中断时 `.part` 保留，下次同版本直接续传
- **安装授权**：Android 8+ 首次拉安装器会跳「允许安装未知应用」授权页（manifest 已声明 `REQUEST_INSTALL_PACKAGES`），授权返回后再点一次「立即安装」即装；授权返回后若已授权会自动续装一次
- **清单错误 / 无网**：自动检查静默失败；手动检查 toast「检查更新失败」
- **浏览器 / iOS**：仅 Android 原生环境启用更新；浏览器里手动检查提示「请在 Android 应用内检查更新」
- 调试辅助：`localStorage["update.debugManifestUrl"]` 可把清单指到本机回环地址（配合 `adb reverse tcp:8090 tcp:8090` 起本地 HTTP 服务全流程演练），只接受 localhost/127.0.0.1，线上无副作用
