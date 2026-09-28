# MusicFree Pad

运行在 iPad / Android 平板等大屏移动设备上的音乐播放器（Web + Capacitor 原生壳）。核心功能与 [MusicFreeDesktop](https://github.com/dastuer/MusicFreeDesktop) 对齐，**音源插件与备份数据双向互通**。布局参考网易云音乐 Pad 版，自动适配横屏 / 竖屏。

![tech](https://img.shields.io/badge/React_18-Vite_6-TypeScript-blue) ![pwa](https://img.shields.io/badge/PWA-iPad_Safari-ec4141)

## 功能

- **发现**：推荐歌单（标签 + 分页）、歌单分类浏览、排行榜（分组），全部来自音源插件
- **搜索**：单曲 / 歌单 / 专辑 / 歌手 四类搜索，搜索历史
- **播放器**：完整播放队列（下一首播放、随机、单曲循环、整队替换）、音质档位与自动降级、播放失败自动跳歌、歌词滚动（点行跳转）、MediaSession（锁屏控制）
- **我的音乐**：我喜欢的音乐（红心）、自建歌单、最近播放
- **音源插件**：与 MusicFree 移动端 / 桌面端同一套插件协议（`.js` 文件、sha256 源码 hash、同一依赖白名单），支持 URL / 本地文件 / 聚合订阅源安装，用户变量、启用开关、排序、设为默认
- **全局音源切换**：顶栏搜索框右侧一处切换，按当前页面所需能力过滤可选音源；手动切换仅本次运行有效，重启后回到默认音源
- **备份与恢复**：备份文件结构与桌面端完全一致（`format: "musicfree-desktop"`），歌单（含「我喜欢的音乐」）、插件（本地插件内嵌源码）、播放队列等偏好可互相恢复；支持追加 / 覆盖默认歌单 / 完整覆盖三种恢复模式；支持**本地文件 / URL / WebDAV** 三个通道
- **WebDAV 云备份**：与桌面端同一通道——填同一个服务器、把文件路径指向桌面端的 `/MusicFree/MusicFreeDesktopBackup.json` 即可互相同步；自动递归建目录；密码只存本机、不进备份文件
- **横竖屏自适应**：竖屏上下堆叠、横屏左右分栏（正在播放页）；网格列数随宽度自适应
- **原生应用**：基于 Capacitor 打包 Android / iOS（见下文），原生网络栈天然无跨域、支持自定义请求头
- **系统返回**：Android 返回键 / 全面屏返回手势、iOS 侧滑返回统一接管——先收起浮层（正在播放页 / 播放队列 / 操作面板 / 对话框），再回退页面；已经在最外层则把应用退到后台（音乐继续播放），不会直接退出应用

## 快速开始

```bash
npm install
npm run dev        # 开发（局域网可访问，iPad 直接打开 http://<电脑IP>:5174）
npm run build      # 生产构建 -> dist/
npm run preview    # 本地预览 dist
```

iPad 上体验最佳的方式：用 Safari 打开地址 → 分享 → **添加到主屏幕**（PWA 全屏运行，锁屏也能续播）。

## 运行形态与网络通道

同一套 Web 代码有三种运行形态，网络策略自动适配：

| 形态 | 插件 API 请求 | 带请求头的媒体直链 | WebDAV |
|---|---|---|---|
| 浏览器（PWA） | 直接 fetch（源需支持 CORS） | 无法带头，需伴生代理 | 直接 fetch 或走代理 |
| 浏览器 + 伴生代理 | 走 `POST /relay` | 走 `GET /media` | 走 `POST /relay` |
| **原生 App（Capacitor）** | Worker → 宿主 → **CapacitorHttp 原生网络栈**（无跨域限制） | 原样直连 | CapacitorHttp 直连 |

### 可选：伴生代理（浏览器形态用）

iPad 浏览器有两个桌面端没有的限制：插件接口可能被 CORS 拦截；歌曲直链需要的 Referer/UA/Cookie 请求头 `<audio>` 无法携带。在与设备同局域网的电脑上运行：

```bash
npm run proxy     # 默认端口 7952，会打印局域网地址
```

然后把地址填进「设置 → 网络 → 伴生代理」。原生 App 内无需配置。

## 打包原生应用（Android / iOS）

基于 Capacitor 8，Web 产物从 `dist/` 同步进原生工程：

```bash
npm install
npm run build          # 产出 dist/
npx cap add android    # 首次添加平台（已添加过则跳过）
npx cap add ios
npm run cap:sync       # 每次改完 Web 代码后：构建 + 同步
npm run open:android   # Android Studio 打开（需 Android SDK + JDK 21+）
npm run open:ios       # Xcode 打开（macOS）
```

- **图标 / 启动图**：`npm run gen:icons` 会重新生成 PWA 图标、`assets/logo.png`(1024)、`assets/splash.png`(2732) 并调用 `capacitor-assets` 写入两个原生工程。
- **已做好的原生配置**：Android 允许明文 http（`usesCleartextTraffic`）；iOS 放开 ATS（`NSAllowsArbitraryLoads`）、开启后台音频（`UIBackgroundModes: audio`）、iPad 四方向支持；状态栏 / 导航栏配色随暗色主题（`@capacitor/status-bar`）；返回手势——Android 返回键 / 全面屏手势走 `@capacitor/app` 的 `backButton` 事件，iOS 侧滑返回在 `ios/App/App/ViewController.swift` 里打开 WKWebView 的历史导航手势，两者统一由 `src/core/systemBack.ts` 消费（浮层 → 页面 → 退到后台）。
- **Android 出包**：`npm run open:android` 后在 Android Studio 里 `Build > Build APK(s)`（调试包）或生成签名 Bundle（上架）。
- **本机命令行出包（已配好，可直接用）**：SDK 在 `~/Library/Android/sdk`（已装 platform-36 / build-tools 35+36 / platform-tools，`android/local.properties` 已指向），构建 `cd android && ./gradlew assembleDebug`，产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。装机：`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`，或把 APK 发到设备上直接安装。
- 上架用签名包：在 `android/app/build.gradle` 配好 signingConfig 后跑 `./gradlew assembleRelease`（或 bundleRelease 出 AAB）。
- **iOS 出包**：`npm run open:ios`，选择目标设备直接 Run 到真机 / 模拟器；命令行验证能否编过：`npm run ios:build`（模拟器 SDK，无需签名）。
- **iOS 开发签名 IPA（命令行，v1.0.0 即用此法）**：

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/mfp-archive/MusicFreePad.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath /tmp/mfp-archive/MusicFreePad.xcarchive \
  -exportPath /tmp/mfp-ipa \
  -exportOptionsPlist ios/export-options-development.plist -allowProvisioningUpdates
```

  签名配置见 `ios/export-options-development.plist`（`method=development` + 自动签名，team `W6L82BPQT7`）。**这类包只能装在描述文件里已注册的设备上**（当前就一台：UDID `00008027-000D58E11184002E` 的 iPad Pro），且要用 Xcode / Apple Configurator / `xcrun devicectl device install app` 安装，不能像 APK 那样点文件直接装。本机只有 Apple Development 证书，没有 Distribution 证书，所以出不了 TestFlight / App Store 包。
- 装到已连接的 iPad：`npm run ios:device`（构建 + 安装 + 启动一条龙）。

## 插件兼容性

- 插件文件格式与 MusicFree 移动端 / MusicFreeDesktop **一致**：CommonJS 风格 `module.exports`，桌面端已装的插件文件可直接安装
- 沙箱：Web Worker 内 Function 构造器 + 白名单 require（axios、cheerio、crypto-js、dayjs、big-integer、qs、he、compare-versions；webdav 为占位实现）
- 插件 hash 同为 `sha256(源码)`；元信息存 `localStorage["plugin.meta"]`（与桌面端 configStore 同名同构）
- 支持的插件方法：`search` / `getMediaSource` / `getLyric` / `getMusicSheetInfo` / `getAlbumInfo` / `getArtistWorks` / `getRecommendSheetTags` / `getRecommendSheetsByTag` / `getTopLists` / `getTopListDetail`

开发联调可用仓库自带的假数据插件：`http://localhost:5174/mock-plugin.js`（仅 dev/preview 下存在）。

## 数据与备份

| 数据 | 位置 | 与桌面端的关系 |
|---|---|---|
| 用户歌单（含 my-likes） | `localStorage["userSheets"]` | 结构同桌面端 store.json 的 `userSheets` |
| 播放历史 | `localStorage["musicHistory"]` | 同构（上限 300） |
| 插件源码 | IndexedDB `musicfree-pad/pluginCode` | hash 规则同桌面端 `plugins/<hash>.js` |
| 播放队列 / 偏好 | `localStorage`（playList、volume、theme、pageSource.* 等） | 与桌面端备份的 `preferences` 白名单一致 |
| 备份文件 | `format: "musicfree-desktop"`, `version: 1` | 桌面端导出的备份可直接导入 Pad，反之亦然 |

差异说明：最近播放不参与备份（与桌面端一致）；本地音乐（localMusic）Pad 端不支持，恢复时自动跳过并提示。WebDAV 通道已实现，但浏览器形态要求服务端允许跨域（Nextcloud / Alist 大多支持），否则请配伴生代理或直接用原生 App；密码只存本机，不进备份文件。

## 目录结构

```
src/
  core/          # 与桌面端同构的业务内核
    pluginHost.ts    # 插件宿主（安装/升级/备份恢复，IndexedDB 存储）
    pluginWorker.ts  # 插件沙箱 Worker（Function 沙箱 + 白名单 require + axios 适配器）
    trackPlayer.ts   # 播放器核心（队列/音质降级/失败自救/MediaSession/歌词）
    backup.ts        # 备份导出/恢复（musicfree-desktop 格式）
    musicSheet.ts / musicHistory.ts / searchHistory.ts / appConfig.ts
    theme.ts / router.ts / systemBack.ts / mediaSource.ts / pluginUtils.ts / net.ts
  components/    # base（MusicList/SheetCardGrid/Toast/Slider...）+ layout（Sidebar/TopBar/PlayerBar/NowPlaying/PlayQueuePanel）
  pages/         # home / search / sheetDetail / topListDetail / albumDetail / artistDetail / myMusic / history / pluginManage / settings
  hooks/         # usePagedMusicList（展示分页 ↔ 音源页码桥接）
server/proxy.mjs # 可选伴生代理（CORS 转发 + 带请求头媒体流）
scripts/gen-icon.mjs # PWA 图标生成（纯 Node）
```

## 后续可扩展

- 歌词翻译显示、均衡器、音频焦点抢占细节
- 真正的分发渠道：iOS 上架（需 Apple Distribution 证书 + App Store Connect）、Android 签名 AAB 上架 Google Play

