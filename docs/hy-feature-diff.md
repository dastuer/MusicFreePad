# MusicFreeHy(手机版) → MusicFreePad(平板版) 功能差异与同步清单

> 生成于 2026-10-10,基于对两边源码的逐文件对比。
> 手机版:`/Users/huah/Desktop/WorkSpace/MusicFreeHy`(下文简称 **Hy**)
> 平板版:`/Users/huah/Desktop/WorkSpace/MusicFreePad`(本项目,下文简称 **Pad**)
> 文中 `Hy: core/xxx.ts:100-120` 均指手机版项目内路径,可直接对照移植。
>
> 状态标记:`[ ]` 待同步 · `[x]` 已完成 · `[~]` 不需要/不移植

---

## 一、总体结论

两边共享同一套基座(见下节),但手机版在此之上多了约 10 个完整功能模块:
下载体系、本地音乐、音频缓存、定时关闭、媒体通知、列表多选批量操作、局部搜索、歌词翻译等。
**Pad 的功能面基本是手机版的子集**,外加平板专属的双栏布局与交互。

### 两边共享、无需动的基座

- 队列管理、「下一首播放」(_pendingNext)、随机/单曲循环
- 无缝切音质(probe 预取+交接,两边算法一致,Pad 最近一次提交即此项)
- 音质降级重试(MAX_QUALITY_RETRY=3)、连续失败自动跳歌(MAX_AUTO_SKIP=3)
- 播放进度记忆(restoreSession/persistProgress)、音量记忆
- 倍速内核 setRate/rateAtom(两边都有,**但 Pad 无任何 UI 入口**)
- 均衡器两边都没有

---

## 二、同步清单

### 第一批:小成本高收益

#### 1. [x] 定时关闭(睡眠定时)

- **Hy 实现**:`core/scheduleClose.ts`(176 行)+ `components/base/SleepTimerSheet.tsx`(154 行)
- **要点**:
  - 快捷 10/20/30/45/60 分钟 + 自定义分钟数 +「播放完歌曲再关闭」勾选
  - 「立即关闭」走 2 秒音量渐弱再暂停(100ms tick,淡出被打断自动恢复音量)
  - 关闭 = 暂停保留进度,不是退出应用;「播完再关」挂 PlayEnd 事件(单曲循环下 audio.loop 永不 ended,直接关)
  - 倒计时 + 预计关闭时刻 ETA 展示
  - Hy 入口在抽屉菜单(`AppDrawer.tsx:82-87`),挂载于 `App.tsx:181`;**Pad 建议放 NowPlaying 更多菜单或 PlayerBar**
- **Pad 状态**:完全缺失(grep scheduleClose / SleepTimer 全无)

#### 2. [x] 倍速播放 UI

- **Hy 实现**:`NowPlaying.tsx:60` RATE_OPTIONS(0.75/1/1.25/1.5)、`502-513` openRateSheet 单选面板、更多菜单入口 `560-563`
- **Pad 状态**:`trackPlayer.ts` 的 `setRate`/`rateAtom` 已有(`Pad: core/trackPlayer.ts:200,1244-1250`),**全项目无 UI 调用**,只需搬 UI
- 注意:两边倍速均不持久化,重启回 1x(如需持久化是新需求)

#### 3. [x] 列表局部搜索

- **Hy 实现**:`components/base/ListSearchBar.tsx`(覆盖顶栏、自动聚焦、系统返回退出、自带无结果空态)+ `hooks/useListSearch.ts`(按歌名/歌手/专辑前端过滤,分页新数据自动进过滤范围)
- 用于专辑/歌手/歌单/历史/榜单详情页
- **Pad 状态**:无此组件;Pad 列表一屏几百行,大歌单找歌很实用

#### 4. [x] 列表多选 + 批量操作

- **Hy 实现**:
  - `hooks/useMusicMultiSelect.ts`:勾选集合、全选/反全选、批量下载选音质、批量收藏到歌单、批量删除(从歌单删/删下载文件)
  - `components/base/PlayAllBar.tsx`:「播放全部 (N)」栏,右侧多选入口;多选态切换为「全选 / 已选 N / 完成」
  - `components/base/SelectActionsBar.tsx`:多选吸底操作栏(下载/收藏/喜欢/删除,未选中置灰)
  - `components/base/SingleSelectSheet.tsx`:通用单选底部浮窗(如下载音质选择)
  - MusicList 多选模式(`Hy: components/base/MusicList.tsx:156-171,238-257`,序号位变勾选圈)
- **Pad 状态**:全部缺失
- **移植提示**:平板大屏做多选比手机更舒服,这是适配平板形态的增强;但注意 Pad 的 MusicList 是自己内置分页的版本(`Pad: components/base/MusicList.tsx:94-114,299-310`),多选逻辑要合并进 Pad 版 MusicList 而不是直接覆盖

#### 5. [x] 音质菜单细化

- **Hy 实现**:`NowPlaying.tsx:437-475` openQualitySheet
  - 按当前歌 `qualities` 过滤可用档(插件没有该档显示「已降级播放」提示 `460-464`)
  - 显示文件大小 formatQualitySize
  - 勾选跟随**实际播放档** `playingQuality ?? quality`(`457`)
- **Pad 现状**:`NowPlaying.tsx:320-344` 固定列全部四档、不按 qualities 过滤、无大小、勾选跟请求档
- Pad 已有 `playingQualityAtom`(`Pad: core/trackPlayer.ts:203`),改动量很小

#### 6. [x] 单曲操作菜单补齐

- **Hy**:`MusicActionSheet`(单曲更多菜单)= 下一首播放/喜欢/**收藏到歌单**/查看专辑/**查看歌手**/**下载(带已下载音质对比提示)**/移出本列表(`Hy: MusicList.tsx:390-492`)
- **Pad** = 下一首播放/喜欢/查看专辑/移出本列表(`Pad: MusicList.tsx:177-222`)
- 缺:收藏到歌单(AddToSheetPanel 组件 Pad 已有,只差菜单项)、查看歌手、下载(依赖下载体系,见第三批)
- 另:Hy 的 MusicActionSheet 支持自定义 title/subtitle(`Hy: MusicActionSheet.tsx:19-24`,批量删除场景用),Pad 只能显示歌曲自身信息

### 第二批:播放体验

#### 7. [ ] 播放音频缓存

- **Hy 实现**:`core/audioCache.ts`(554 行)+ trackPlayer 集成(`Hy: core/trackPlayer.ts:1404-1416` 播放时、`1686-1697` 无缝切音质时)
- **机制**:
  - 三通道存储:Android Storage 插件写 cacheDir / iOS Filesystem CACHE / 浏览器 Cache API(`mf-audio-v1`)
  - 索引在 localStorage `audioCache.index`,缓存键 `platform-id@quality`
  - `lookupCachedSrc`(`223-283`)命中前校验文件存在,漂移自动摘条目回退在线;LRU 刷新 + 保护正在播放键
  - `requestAudioCacheStore`(`332-358`)fire-and-forget 后台串行任务链,新请求 abort 在途下载
  - **试听片段防御** `looksLikeTrialFragment`(`207-212`):按 96kbps 估算字节数,写入前拦截 + 命中旧条目自愈清除,防「这首歌永远只能听 30 秒」
  - 容量上限 2G/5G/10G/不限(`27-32`),LRU 淘汰(`501-527`),设置页展示占用(`audioCacheVersionAtom`)
  - CORS 拦截时走伴生代理 `/media` 转发(`416-450`)
- **Pad 状态**:完全缺失,play() 直接播线上直链
- **移植收益**:二次播放秒开、省流量、断网可听缓存过的歌;独立模块,移植成本中等、收益最大

#### 8. [x] Android 媒体通知/锁屏控制(2026-10-10 已完成,见「六、已完成记录」)

#### 9. [ ] 断流原地重连

- **Hy 实现**:`core/trackPlayer.ts:55-56`(MAX_STREAM_RECONNECT=2)、`669-706` tryReconnectStream(同一直链重挂+断点续播)、`708-721` onAudioError 对错误码 2 先重连再走失败链
- **Pad 现状**:onAudioError(`Pad: core/trackPlayer.ts:521-528`)一律直接进「降级→跳歌」失败链;stalled 微调 3 次后直接放弃(`487-489`),Hy 是救不回再触发重连(`566-569`)

#### 10. [ ] 共播模式 / 音频焦点自愈

- **Hy 实现**:`core/trackPlayer.ts:68-71`(续播延迟 300ms/冷却 15s)、`580-595` onAudioPause 区分主动暂停 vs 系统抢焦点、`601-633` maybeResumeAfterFocusLoss(被抢焦点后延迟回抢)、`1902-1917` applyCoPlaySessionType(Audio Session API 设 ambient,feature-detect)
- 依赖 appConfig 的 `allowCoPlay`(`Hy: core/appConfig.ts:28-35`)+ 设置开关(`Hy: settings/index.tsx:196-208`)
- **Pad 状态**:onAudioPause(`499-507`)无任何焦点处理;appConfig 无 allowCoPlay

#### 11. [ ] 单曲循环无缝化

- **Hy**:`core/trackPlayer.ts:1598-1603` syncLoopFlag 用 `audio.loop`,播完零间隙重头(play:1419、commitQualitySwitch:1832 均同步)
- **Pad**:靠 onEnded 里 `currentTime=0 + play()`(`681-695`),有重载间隙

#### 12. [ ] 队列拖拽排序

- **Hy**:`core/trackPlayer.ts:1110-1122` reorderMusic
- **Pad**:播放队列面板(PlayQueuePanel)只能看不能拖;Hy 用 @dnd-kit 做拖拽(Pad 未装该依赖,移植时需 `npm i @dnd-kit/core @dnd-kit/sortable` 或改用原生 HTML5 拖拽),面板侧加拖拽即可

#### 13. [ ] MediaSession 增强(iOS/Web 路径)

- **Hy**:`core/trackPlayer.ts:1284-1289` seekto(锁屏/耳机拖进度)、`1293-1322` syncMediaSessionState(setPositionState + playbackState,iOS 锁屏进度)、`1324-1335` clearMediaSession(队列播完清掉会话)
- **Pad 现状**:updateMediaSession(`970-987`)仅 metadata + play/pause/prev/next 四按键
- 注意:Android WebView 里 MediaSession 无效(已被第 8 项的原生通知覆盖),此项主要惠及 iOS/Web

#### 14. [ ] 歌词翻译

- **Hy 实现**:
  - 解析:`core/trackPlayer.ts:1972-2006` loadCurrentLyric 读 `lyricSource.translation`;`2008-2059` parseLrc 双时间轴双指针就近对齐(0.4s 容差)挂到 `line.translation`
  - UI:`NowPlaying.tsx:147` 读 `lyricTranslationAtom`(uiAtoms.ts:134,持久化开关)、`623-627` 与 `650-655` 渲染
  - 设置开关:`settings/index.tsx:185-195`
- **Pad 状态**:parseLrc(`1567-1587`)只解析原文;uiAtoms 无 lyricTranslationAtom

#### 15. [ ] 加载态防抖(播放键不抖动)

- **Hy**:`core/trackPlayer.ts:635-649` onAudioPlay(isLoading 及 readyState<3 时不抢状态)、`651-663` onAudioPlaying(换歌在途时迟到事件忽略)、`1450-1456` resume(自动播放被拦截时从 loading 回退 paused)
- **Pad**:onAudioPlay 直接置 playing(`509-511`)

#### 16. [ ] 播放中曲目元数据热更新(配合本地音乐/下载)

- **Hy**:`core/trackPlayer.ts:968-992` updateMusicItemMeta(匹配到歌词/封面后同步进当前歌与队列并落盘,`localMusic.ts:1481` 调用)
- Pad 如不做本地音乐可跳过

### 第三批:大块功能(建议各自作为独立里程碑)

#### 17. [ ] 歌曲下载体系

- **Hy 实现**(约 3800 行,最大的一块):
  - `core/musicDownload.ts`(1643 行):并发下载队列(5 并发,`77-131/230/1536-1555`)、任务落盘重启恢复为暂停(`125-227`)、入队去重/高音质覆盖(`1121-1164`)、失败降档重试(`1384-1491`)、「不倒退」校验(`1436-1455`)、三种拉流通道(原生直落磁盘 `735-818` → 分块 Range 令牌桶限流 `881-1013` → 伴生代理回退 `1310-1318`)、保存位置+子文件夹(`522-597`)、**已下载的歌优先播本地文件**(`332-399`,经 `setDownloadedSourceResolver` 注册进 trackPlayer)、删除+清 .part(`401-520/670-709`)、批量下载静默汇总(`1095-1119/1181-1206`)
  - `pages/downloads/index.tsx`(248 行):总进度条+暂停/继续/停止/重试失败/清除失败(`36-107`)、任务行与完成记录统一列表(`109-159`)、局部搜索(`151`)、播放全部/多选(`159-237`)
  - `hooks/useDownloadsMultiSelect.ts`(130 行)
  - `pages/folderSelect/index.tsx`(710 行,single 模式选下载目录):system/documents/data/external 四种落点(`musicDownload.ts:524-597`)、Android「所有文件访问」授权引导、可写探针、新建文件夹、目录滚动位置记忆、返回键优先回上级
  - 依赖 `core/native.ts` 的分块写文件(`216-274`)与原生直落磁盘下载(`276-353`)——**移植时需对照 Pad 版 native.ts(130 行基础版)补齐这些函数**
  - trackPlayer 侧:`IDownloadedLocalSource` 注册机制(`Hy: core/trackPlayer.ts:285-307`)、播前先问下载记录(`1188-1193`)、本地文件播坏自动切线上并记 bypass(`831-839`)
- **Pad 状态**:完全缺失;设置页也需加「下载 → 保存位置」入口(Hy: `settings/index.tsx:251-265`)
- **提示**:若只想先要「离线可播」,第 7 项音频缓存能覆盖大半需求,可先行

#### 18. [ ] 本地音乐扫描与曲库

- **Hy 实现**:
  - `core/localMusic.ts`(1582 行):曲库记录 ILocalMusicRecord(含码率/采样率/封面/匹配歌词路径,`72-108`)、扫描目录默认跟随下载保存位置(`276-338`)、Android 原生 LocalMusicPlugin 扫描(`448-452`,依赖 Hy 原生工程里的 `LocalMusicPlugin.java` + `StoragePlugin.java` + MediaStore 权限)/**iOS Filesystem 遍历 + audio 探测时长(`496-705`)**、权限申请(`387-399`)、**匹配歌词与封面**(逐首插件搜索打分,编辑距离 `1112-1134`、选优 `1165-1199`,落盘到 match_meta `1260-1328`)、任务可暂停/续跑/进程被杀自动恢复(`759-1001`)、单曲「获取封面歌词」(`1450-1486`)、删除(可选连文件,`1506-1555`)
  - `pages/localMusic/index.tsx`(705 行)+ `pages/folderSelect` 的 multi 模式(`444-489` 勾选扫描目录)
  - 设置页入口:`settings/index.tsx` + myMusic 页入口行(`Hy: pages/myMusic/index.tsx:89`)
- **Pad 状态**:完全缺失;`Pad: core/router.ts:5` 注释明确写了 localMusic 在 Pad 版没有对应能力
- **提示**:工程量最大,且 Android 原生侧要搬 LocalMusicPlugin/StoragePlugin;做家庭媒体中心才需要

### 顺手小项(成本低,可随批次搭车)

#### 19. [ ] 插件管理页增强

- Hy 有而 Pad 无:插件详情底部面板 PluginDetailSheet(作者/平台标识/运行状态/描述/来源链接复制/插件指纹复制/支持能力标签/用户变量展示,`Hy: pages/pluginManage/index.tsx:39-142`)、拖拽排序(`149-265,342-356,457-482`)、**取消默认音源**按钮(`227-230,370-379`,Pad 目前设了默认就无法取消)
- Pad 已有且不同:用户变量 openPrompt 批量编辑(Pad 更顺手)、更新流程区分 installed/updated/unchanged(Pad 更细)、已启用统计条(Pad 有)——保持

#### 20. [ ] 插件装卸后首页热更新

- **Hy**:`usePluginsVersion()` 监听(`Hy: pages/home/index.tsx:253-256,379-383`)
- **Pad**:getPlugins 仅挂载拉一次(`Pad: pages/home/index.tsx:135-137`),装/卸插件后要手动刷新

#### 21. [ ] 音源解析失败原因人话化

- **Hy**:resolveMediaUrl 返回 `{ok:false, reason}`,`core/trackPlayer.ts:1194-1211` 区分「插件未安装/已被禁用/挂载失败」
- **Pad**:返回 null,统一一句「音源没有返回可播放的链接」(`1042`),函数私有(若做下载体系,此函数需导出复用)
- 另:单次解析超时 Hy 15s(`:50`)、Pad 10s(`:46`)

#### 22. [ ] WebDAV 安卓兼容加固

- **Hy**:`core/dav.ts` 处理 Android CapacitorHttp 发不出 PROPFIND/MKCOL 等扩展方法:方法白名单(`91-95`)、errText 解析(`106-114`)、`needsStandardMethodOnly`(`116-122`)、davRequest 原生分支回退(`165-181`)、ensureDirectory 跳过 MKCOL(`226-252`)、testWebdav 回退 GET(`269-305`)、checkWebdavBackupExists 多方法回退(`361-397`)、409/401 错误细化(`327-335`)、WebDAV 子页有「上次上传+上次下载」时间戳
- **Pad**:`dav.ts`(312 行)仅 PROPFIND,无任何安卓兼容处理 —— Pad 若常跑安卓,值得整体同步

#### 23. [ ] 备份恢复体验小补

- 恢复偏好后立即生效:Hy 恢复后调 `notifyDefaultPluginHashChanged/notifyGlobalSourceChanged`(`Hy: core/backup.ts:184-192`);Pad 只写 localStorage 靠 reload(可保留 Pad 的 reload 方案,二选一)
- 恢复失败点名音源及原因:Hy `describeResumeSummary`(`Hy: core/backup.ts:522-533`)
- 从 URL 恢复的后缀校验:Hy 仅允许 .json/.txt(`pages/backupRestore/index.tsx:148`);Pad 接受任意链接
- 备份白名单差异:Hy 多备份 `globalSourceHash`(Hy backup.ts:126-138);Pad 多备份 `pageSource.*` 前缀键(Pad backup.ts:135,对应 Pad 的按页面音源功能)——**这条合并时注意别互相覆盖**

---

## 三、不建议照搬(形态不匹配或 Pad 已有更好实现)

| 项目 | 原因 |
|---|---|
| 横滑切 tab(useTabSwipe)、下拉刷新(PullToRefresh)、AppDrawer/TabBar/MiniPlayer | 手机手势体系,平板双栏布局用不上;但「tab 切换不卸载页面、保留数据和滚动位置」的常驻缓存思路可借鉴——Pad 现在切 tab 会重载数据(`Pad: pages/home/index.tsx` 条件渲染) |
| 备份恢复独立页(pages/backupRestore) | Pad 内联在设置页是合理形态,功能等价 |
| 搜索页页内输入框、音源 chips(SourceSelectSheet) | Pad 的顶栏统一搜索 + SourceSwitcher 是更好的平板形态 |
| 骨架屏(MusicListSkeleton)、AutoLoadMore | Pad 已有等效实现,且 Pad 独有「加载失败点击重试」按钮和翻页失败不锁死逻辑(`Pad: pages/home/index.tsx:216-219,356-365`) |
| 歌单标签二级分类浮窗(SheetTagsPanel) | Pad 用可折叠 tag chips + 按 id 去重(`sanitizeSheetTags`),健壮性更好 |
| 首页快捷入口行、推荐歌单横滑行、最近在听 | Pad 布局不同:最近在听在 myMusic 页(`Pad: pages/myMusic/index.tsx:169-183`) |
| 质量文案「流畅/极高」 | Pad 叫「低品/标准/高品/无损」,保持即可 |

---

## 四、Pad 版独有(保持,不要被手机版覆盖)

- **双栏布局**:常驻 Sidebar(六项导航)/ TopBar(返回/标题/搜索/音源切换)/ PlayerBar
- **SourceSwitcher**(顶栏音源切换):按当前页面所需插件能力(method)过滤可选音源、默认徽标、手动切换的「本次有效」会话覆盖圆点、当前音源不支持本页的降级提示(`Pad: components/base/SourceSwitcher.tsx:1-138`)——手机版没有 per-page 能力过滤与会话覆盖
- 网格化内容:SheetCardGrid、专辑/歌手卡片墙
- NowPlaying:音量按钮+VSlider 纵向弹层、黑胶唱片唱针动画、歌词二分查找激活行
- MusicList:内置数据分页、触屏滚动防误触(`22-25,116-169`)
- 详情页 `pickPlayAllStart` 随机起始播放、无插件空态「去安装音源插件」引导
- 备份:数量统计展示(getBackupCounts UI)、恢复后自动刷新、pageSource.* 偏好备份
- 设置页:原生环境「无需配置伴生代理」提示文案

---

## 五、共享文件行数对照(粗略判断分叉规模)

| 文件 | Hy | Pad | 备注 |
|---|---|---|---|
| core/trackPlayer.ts | 2059 | 1587 | Hy 多出缓存/重连/共播/本地源/歌词翻译等(见清单 7-16) |
| components/layout/NowPlaying.tsx | 766 | 445 | 翻译/滑动定位/倍速/下载入口(清单 2/14) |
| pages/home/index.tsx | 733 | 458 | 手势/缓存/标签浮窗(不移植,见第三节) |
| pages/pluginManage/index.tsx | 495 | 314 | 清单 19 |
| components/base/MusicList.tsx | — | — | 两边各自演化,合并多选时需手工融合(清单 4) |
| pages/settings/index.tsx | 316 | 411 | Pad 因内联代理/备份/WebDAV 而更长 |
| core/dav.ts | 397 | 312 | 清单 22 |
| core/backup.ts | 543 | 516 | 清单 23 |
| pages/search/index.tsx | 392 | 260 | 形态不同,不移植 |
| core/native.ts | 354 | 130 | 清单 17 依赖其分块写入/原生下载 |
| core/mediaNotification.ts | 230 | 230 | **已完成移植** |

---

## 六、已完成记录

### [x] Android 媒体通知/锁屏控制(2026-10-10)

来源:Hy 的 `core/mediaNotification.ts` + 原生 `MediaNotificationPlugin.java` / `MediaPlaybackService.java`

落地文件(Pad):
- `src/core/mediaNotification.ts` — JS 桥(Pad 的 trackPlayer atom 与播放器方法与 Hy 同名,零改动)
- `android/.../pad/MediaNotificationPlugin.java`、`MediaPlaybackService.java` — 包名/ WakeLock 标识改为 Pad
- `MainActivity.java` — super.onCreate 前 registerPlugin
- `AndroidManifest.xml` — 服务声明 + POST_NOTIFICATIONS / FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PLAYBACK / WAKE_LOCK / REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
- `app/build.gradle` — androidx.media:media:1.7.0
- `res/drawable/ic_notification.xml` — 通知小图标
- `src/App.tsx` — 启动挂载 setupMediaNotification()
- `src/pages/settings/index.tsx` — 「后台播放保活」入口(仅安卓,visibilitychange 刷新状态)

验证:tsc / vite build / Java 编译 / assembleDebug 全过;已在平板实测(通知卡片、元数据、秒级进度推送正常)。

### [x] 局域网部署脚本(2026-10-10)

- `scripts/device.mjs` 从 Hy 移植(mDNS 自动发现 / 构建 / 安装 / 启动 / 调试端口转发)
- 新增 npm 命令:`android:connect` / `android:run` / `android:log` / `android:live`(热重载)
- 平板(192.168.1.7)已与本机完成无线调试配对,后续直接 `npm run android:run`

### [x] 第一批:小成本高收益(2026-10-10,清单 1-6)

落地内容(Pad):
- 新增 `core/scheduleClose.ts`(与手机版同款:到点暂停保留进度、2s 音量渐弱、播完再关挂 PlayEnd)、`components/base/SleepTimerSheet.tsx`;入口在 NowPlaying 更多菜单「定时关闭」
- 倍速:`trackPlayer` 补 `useRate` hook,NowPlaying 更多菜单「倍速播放」→ SingleSelectSheet(0.75/1/1.25/1.5)
- 局部搜索:新增 `components/base/ListSearchBar.tsx` + `hooks/useListSearch.ts`,接入 歌单详情/历史/专辑/歌手/榜单详情 五个页面(详情页页头加「搜索」按钮)
- 多选:新增 `hooks/useMusicMultiSelect.ts`(去掉下载相关,第三批再补)、`PlayAllBar`(多选态行)、`SelectActionsBar`(收藏/删除)、`MusicList` 融合 selectMode(勾选圈/隐藏行尾按钮/点行切换勾选);接入歌单详情(全选/批量收藏/批量从歌单删除,复用已有的 removeMusicFromSheetMany)与历史页(批量收藏);MusicActionSheet 支持自定义标题/副标题(批量删除确认)
- 音质菜单:改为 SingleSelectSheet——按当前歌 qualities 过滤档位、显示文件大小(formatQualitySize 入 utils)、勾选跟随实际播放档(playingQuality)、降级播放提示
- 单曲菜单:MusicList 与 NowPlaying 的更多菜单补「收藏到歌单」「查看歌手」
- 基建:uiAtoms 加 sleepTimerOpenAtom/singleSelectAtom 与 IMusicActionState title/subtitle;App.tsx 挂载 SleepTimerSheet + SingleSelectSheet;Icons 补 IconCheck/IconMultiSelect/IconDownload;global.css 补齐对应样式
