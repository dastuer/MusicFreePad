import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentRoute } from "@/core/router";
import { getPlugins, type SerializedPlugin } from "@/core/ipc";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { pluginCall } from "@/core/ipc";
import { addSearchHistory, getSearchHistory, removeSearchHistory, clearSearchHistory } from "@/core/searchHistory";
import { navigate } from "@/core/router";
import MusicList from "@/components/base/MusicList";
import SheetCardGrid from "@/components/base/SheetCardGrid";
import Cover from "@/components/base/Cover";
import { IconClose } from "@/components/base/Icons";

/**
 * 搜索页：单曲/歌单/专辑/歌手 四类结果，搜索历史。音源在顶栏全局切换。
 */

type SearchType = "music" | "sheet" | "album" | "artist";

const TYPE_TABS: { key: SearchType; label: string }[] = [
    { key: "music", label: "单曲" },
    { key: "sheet", label: "歌单" },
    { key: "album", label: "专辑" },
    { key: "artist", label: "歌手" },
];

export default function SearchPage() {
    const route = useCurrentRoute();
    const keyword: string = route.params.keyword ?? "";
    const [plugins, setPlugins] = useState<SerializedPlugin[] | null>(null);
    const sourceHash = useGlobalSource();
    const [type, setType] = useState<SearchType>("music");
    const [history, setHistory] = useState(getSearchHistory());

    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItemBase[]>([]);
    const [albums, setAlbums] = useState<IAlbum.IAlbumItemBase[]>([]);
    const [artists, setArtists] = useState<IArtist.IArtistItemBase[]>([]);
    const [isEnd, setIsEnd] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    const doSearch = useCallback(
        async (kw: string, searchType: SearchType, pageNum: number, replace: boolean) => {
            if (!kw || !plugins) {
                return;
            }
            replace ? setLoading(true) : setLoadingMore(true);
            setError(null);
            const candidates = pickSourcePlugins(plugins, "search", sourceHash);
            let got = false;
            for (const plugin of candidates) {
                try {
                    const res = await pluginCall<any>(
                        plugin.hash,
                        "search",
                        kw,
                        pageNum,
                        searchType,
                    );
                    const data = (res?.data ?? []) as any[];
                    if (searchType === "music") {
                        setMusicList((prev) =>
                            replace ? data : dedupe(prev, data),
                        );
                    } else if (searchType === "sheet") {
                        setSheets((prev) => (replace ? data : dedupe(prev, data)));
                    } else if (searchType === "album") {
                        setAlbums((prev) => (replace ? data : dedupe(prev, data)));
                    } else {
                        setArtists((prev) => (replace ? data : dedupe(prev, data)));
                    }
                    setIsEnd(!!res?.isEnd || !data.length);
                    got = true;
                    break;
                } catch {
                    continue;
                }
            }
            if (!got) {
                if (replace) {
                    searchType === "music" && setMusicList([]);
                    searchType === "sheet" && setSheets([]);
                    searchType === "album" && setAlbums([]);
                    searchType === "artist" && setArtists([]);
                }
                setIsEnd(true);
                if (!candidates.length) {
                    setError("没有音源支持搜索");
                } else {
                    setError("搜索失败，试试切换音源");
                }
            }
            setLoading(false);
            setLoadingMore(false);
        },
        [plugins, sourceHash],
    );

    // 关键词 / 类型 / 音源变化：重搜
    useEffect(() => {
        if (!keyword) {
            return;
        }
        setPage(1);
        setHistory(addSearchHistory(keyword));
        doSearch(keyword, type, 1, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keyword, type, sourceHash, plugins]);

    const loadMore = useCallback(() => {
        if (!keyword || loadingMore || isEnd) {
            return;
        }
        const next = page + 1;
        setPage(next);
        doSearch(keyword, type, next, false);
    }, [keyword, loadingMore, isEnd, page, type, doSearch]);

    const renderHistory = () => (
        <div className="search-history">
            <div className="search-history-head">
                <span>搜索历史</span>
                <button className="text-btn" onClick={() => setHistory(clearSearchHistory())}>
                    清空
                </button>
            </div>
            <div className="tag-chips">
                {history.map((kw) => (
                    <span key={kw} className="tag-chip removable" onClick={() => navigate("search", { keyword: kw })}>
                        {kw}
                        <button
                            className="tag-chip-remove"
                            onClick={(e) => {
                                e.stopPropagation();
                                setHistory(removeSearchHistory(kw));
                            }}
                        >
                            <IconClose size={11} />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );

    return (
        <div className="page-inner">
            <div className="page-toolbar">
                <div className="seg-tabs">
                    {TYPE_TABS.map((t) => (
                        <button
                            key={t.key}
                            className={`seg-tab ${type === t.key ? "active" : ""}`}
                            onClick={() => setType(t.key)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {!keyword ? (
                renderHistory()
            ) : loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : (
                <>
                    {error && (
                        <div className="page-empty small">
                            <div>{error}</div>
                        </div>
                    )}
                    {type === "music" && musicList.length > 0 && (
                        <MusicList
                            musicList={musicList}
                            listId={`search:${keyword}`}
                            onLoadMore={type === "music" ? loadMore : undefined}
                            loadingMore={loadingMore}
                            isEnd={isEnd}
                            showEndHint={false}
                        />
                    )}
                    {type === "sheet" && sheets.length > 0 && (
                        <SheetCardGrid
                            sheets={sheets}
                            getSubtitle={(it) => (it as any).creator ?? undefined}
                        />
                    )}
                    {type === "album" && albums.length > 0 && (
                        <div className="album-grid">
                            {albums.map((album, idx) => (
                                <div
                                    key={`${album.platform}-${album.id}-${idx}`}
                                    className="album-card"
                                    onClick={() => navigate("albumDetail", { albumItem: album })}
                                >
                                    <Cover src={album.artwork} radius={10} className="album-card-img" />
                                    <div className="sheet-card-title">{album.title}</div>
                                    <div className="sheet-card-sub">{album.artist ?? album.date}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {type === "artist" && artists.length > 0 && (
                        <div className="artist-grid">
                            {artists.map((artist, idx) => (
                                <div
                                    key={`${artist.platform}-${artist.id}-${idx}`}
                                    className="artist-card"
                                    onClick={() => navigate("artistDetail", { artistItem: artist })}
                                >
                                    <Cover
                                        src={artist.avatar}
                                        radius={"50%"}
                                        className="artist-card-img"
                                        size={96}
                                    />
                                    <div className="sheet-card-title">{artist.name}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {!isEnd && type !== "music" && (
                        <div className="load-more">
                            <button
                                className="btn ghost"
                                disabled={loadingMore}
                                onClick={() => {
                                    const next = page + 1;
                                    setPage(next);
                                    doSearch(keyword, type, next, false);
                                }}
                            >
                                {loadingMore ? "加载中…" : "加载更多"}
                            </button>
                        </div>
                    )}
                    {isEnd && !error && (
                        <div className="list-end-hint">
                            {[musicList, sheets, albums,artists].flat().length ? "没有更多了" : "没有找到相关内容"}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function dedupe<T extends { platform: string; id: string }>(prev: T[], incoming: T[]): T[] {
    const seen = new Set(prev.map((it) => `${it.platform}-${it.id}`));
    return [...prev, ...incoming.filter((it) => !seen.has(`${it.platform}-${it.id}`))];
}
