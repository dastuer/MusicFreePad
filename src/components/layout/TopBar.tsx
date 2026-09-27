import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useCurrentRoute, useCanGoBack, goBack, navigate, type RoutePath } from "@/core/router";
import { homeTabAtom } from "@/core/uiAtoms";
import { getSearchHistory } from "@/core/searchHistory";
import SourceSwitcher from "@/components/base/SourceSwitcher";
import { IconChevronLeft, IconSearch } from "@/components/base/Icons";

/**
 * 顶部栏：返回 + 页面标题（发现页是标签组） + 搜索框 + 全局音源切换器。
 * 标签组（推荐/歌单/排行榜）只属于发现页，与网易云 Pad 的顶部标签一致。
 */

const HOME_TABS: { key: "recommend" | "sheets" | "toplist"; label: string }[] = [
    { key: "recommend", label: "推荐" },
    { key: "sheets", label: "歌单" },
    { key: "toplist", label: "排行榜" },
];

const PAGE_TITLES: Record<string, string> = {
    search: "搜索",
    sheetDetail: "歌单",
    albumDetail: "专辑",
    artistDetail: "歌手",
    topList: "排行榜",
    topListDetail: "排行榜",
    myMusic: "我的音乐",
    history: "最近播放",
    pluginManage: "音源插件",
    settings: "设置",
};

/**
 * 当前页面取数据用的插件能力，决定切换器列出哪些音源。
 * 本地内容（自建歌单、我的音乐、最近播放、插件页、设置）没有音源概念，返回 null 不显示。
 */
function sourceMethod(
    path: RoutePath,
    params: Record<string, any>,
    homeTab: "recommend" | "sheets" | "toplist",
): string | null {
    switch (path) {
        case "home":
            return homeTab === "toplist" ? "getTopLists" : "getRecommendSheetsByTag";
        case "search":
            return "search";
        case "sheetDetail":
            return params.userSheetId ? null : "getMusicSheetInfo";
        case "albumDetail":
            return "getAlbumInfo";
        case "artistDetail":
            return "getArtistWorks";
        case "topListDetail":
            return "getTopListDetail";
        default:
            return null;
    }
}

export default function TopBar() {
    const route = useCurrentRoute();
    const canGoBack = useCanGoBack();
    const homeTab = useAtomValue(homeTabAtom);
    const setHomeTab = useSetAtom(homeTabAtom);
    const [keyword, setKeyword] = useState("");
    const [history, setHistory] = useState<string[]>([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const searchBoxRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setHistory(getSearchHistory());
    }, [route.path]);

    // 点到搜索框外（含音源切换器）就收起历史面板
    useEffect(() => {
        if (!panelOpen) {
            return;
        }
        const onDocClick = (e: MouseEvent) => {
            if (!searchBoxRef.current?.contains(e.target as Node)) {
                setPanelOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDocClick);
        return () => document.removeEventListener("pointerdown", onDocClick);
    }, [panelOpen]);

    const doSearch = (kw: string) => {
        const word = kw.trim();
        if (!word) {
            return;
        }
        setPanelOpen(false);
        navigate("search", { keyword: word });
    };

    return (
        <header className="topbar">
            <div className="topbar-left">
                {canGoBack && route.path !== "home" && (
                    <button className="icon-btn topbar-back" onClick={() => goBack()}>
                        <IconChevronLeft size={20} />
                    </button>
                )}
                {route.path === "home" ? (
                    <div className="topbar-tabs">
                        {HOME_TABS.map((tab) => (
                            <button
                                key={tab.key}
                                className={`topbar-tab ${homeTab === tab.key ? "active" : ""}`}
                                onClick={() => setHomeTab(tab.key)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="topbar-title">{PAGE_TITLES[route.path] ?? ""}</div>
                )}
            </div>
            <div className="topbar-right">
                <div className={`topbar-search ${panelOpen ? "focus" : ""}`} ref={searchBoxRef}>
                    <IconSearch size={16} />
                    <input
                        ref={inputRef}
                        value={keyword}
                        placeholder="搜索音乐、歌单、专辑、歌手"
                        onChange={(e) => setKeyword(e.target.value)}
                        onFocus={() => {
                            setHistory(getSearchHistory());
                            setPanelOpen(true);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                doSearch(keyword);
                                inputRef.current?.blur();
                            }
                        }}
                    />
                    {panelOpen && history.length > 0 && (
                        <div className="search-history-panel">
                            {history.map((kw) => (
                                <div
                                    key={kw}
                                    className="search-history-item"
                                    onClick={() => doSearch(kw)}
                                >
                                    <IconSearch size={14} />
                                    <span>{kw}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <SourceSwitcher method={sourceMethod(route.path, route.params, homeTab)} />
            </div>
        </header>
    );
}
