import { useEffect } from "react";
import { useCurrentRoute } from "@/core/router";
import { TrackPlayerSingleton } from "@/core/trackPlayer";
import { setupMediaNotification } from "@/core/mediaNotification";
import { resumeSavedMatchTask } from "@/core/localMusic";
import { pluginHost } from "@/core/ipc";
import { useThemeSetup } from "@/core/theme";
import { ensureLikesSheet } from "@/core/musicSheet";
import { isNative } from "@/core/native";
import { silentCheckForUpdate } from "@/core/appUpdate";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import PlayerBar from "@/components/layout/PlayerBar";
import NowPlaying from "@/components/layout/NowPlaying";
import PlayQueuePanel from "@/components/layout/PlayQueuePanel";
import ToastHost from "@/components/base/ToastHost";
import MusicActionSheet from "@/components/base/MusicActionSheet";
import AddToSheetPanel from "@/components/base/AddToSheetPanel";
import SleepTimerSheet from "@/components/base/SleepTimerSheet";
import SingleSelectSheet from "@/components/base/SingleSelectSheet";
import AudioEffectPanel from "@/components/base/AudioEffectPanel";
import UpdateSheet from "@/components/base/UpdateSheet";
import PromptDialog from "@/components/base/PromptDialog";
import HomePage from "@/pages/home";
import SearchPage from "@/pages/search";
import SheetDetailPage from "@/pages/sheetDetail";
import TopListDetailPage from "@/pages/topListDetail";
import AlbumDetailPage from "@/pages/albumDetail";
import ArtistDetailPage from "@/pages/artistDetail";
import MyMusicPage from "@/pages/myMusic";
import HistoryPage from "@/pages/history";
import DownloadsPage from "@/pages/downloads";
import LocalMusicPage from "@/pages/localMusic";
import FolderSelectPage from "@/pages/folderSelect";
import PluginManagePage from "@/pages/pluginManage";
import SettingsPage from "@/pages/settings";

function renderPage(path: string, params: Record<string, any>) {
    switch (path) {
        case "home":
            return <HomePage />;
        case "search":
            return <SearchPage key={`search:${params.keyword ?? ""}`} />;
        case "sheetDetail":
            return (
                <SheetDetailPage
                    key={`sheet:${params.userSheetId ?? `${params.sheetItem?.platform}-${params.sheetItem?.id}`}`}
                />
            );
        case "topListDetail":
            return (
                <TopListDetailPage
                    key={`toplist:${params.topListItem?.platform}-${params.topListItem?.id}`}
                />
            );
        case "albumDetail":
            return (
                <AlbumDetailPage key={`album:${params.albumItem?.platform}-${params.albumItem?.id}`} />
            );
        case "artistDetail":
            return (
                <ArtistDetailPage key={`artist:${params.artistItem?.platform}-${params.artistItem?.id}`} />
            );
        case "myMusic":
            return <MyMusicPage />;
        case "history":
            return <HistoryPage />;
        case "downloads":
            return <DownloadsPage />;
        case "localMusic":
            return <LocalMusicPage />;
        case "folderSelect":
            return <FolderSelectPage key={`folder:${params.mode}`} mode={params.mode ?? "single"} />;
        case "pluginManage":
            return <PluginManagePage />;
        case "settings":
            return <SettingsPage />;
        default:
            return <HomePage />;
    }
}

export default function App() {
    useThemeSetup();
    const route = useCurrentRoute();

    useEffect(() => {
        // 初始化：插件宿主、播放器、喜欢的音乐歌单
        ensureLikesSheet();
        pluginHost.setup().catch((e: any) => console.warn("[app] 插件宿主初始化失败", e));
        TrackPlayerSingleton.setup();
        // 系统媒体通知（Android 下拉栏媒体卡片；仅原生环境生效）
        setupMediaNotification();
        // 上次没跑完的本地音乐匹配任务（应用退出即中断）：启动时自动续跑
        void resumeSavedMatchTask().catch((e: any) =>
            console.warn("[app] 恢复本地匹配任务失败", e),
        );
        // 检查更新（仅原生环境）：延后 4 秒避开冷启动的解析/播放初始化高峰，
        // 失败静默，有新版才弹面板
        if (isNative()) {
            const updateTimer = setTimeout(() => {
                void silentCheckForUpdate();
            }, 4000);
            return () => clearTimeout(updateTimer);
        }
    }, []);

    return (
        <div className="app-root">
            <div className="app-main">
                <Sidebar />
                <div className="app-content">
                    <TopBar />
                    <main className="page-container" key={`${route.path}`}>
                        {renderPage(route.path, route.params)}
                    </main>
                </div>
            </div>
            <PlayerBar />
            <NowPlaying />
            <PlayQueuePanel />
            <MusicActionSheet />
            <AddToSheetPanel />
            <SleepTimerSheet />
            <SingleSelectSheet />
            <AudioEffectPanel />
            <UpdateSheet />
            <PromptDialog />
            <ToastHost />
        </div>
    );
}
