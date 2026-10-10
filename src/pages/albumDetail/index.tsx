import { useEffect, useState } from "react";
import { useCurrentRoute } from "@/core/router";
import { tryPluginMethod } from "@/core/pluginUtils";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { getPlugins } from "@/core/ipc";
import { TrackPlayerSingleton } from "@/core/trackPlayer";
import MusicList from "@/components/base/MusicList";
import ListSearchBar from "@/components/base/ListSearchBar";
import Cover from "@/components/base/Cover";
import { IconPlay, IconSearch } from "@/components/base/Icons";
import { useListSearch } from "@/hooks/useListSearch";

/** 专辑详情页：getAlbumInfo 分页加载 */
export default function AlbumDetailPage() {
    const route = useCurrentRoute();
    const albumItem: IAlbum.IAlbumItemBase | undefined = route.params.albumItem;
    const [plugins, setPlugins] = useState<any[] | null>(null);
    const sourceHash = useGlobalSource();
    const [albumInfo, setAlbumInfo] = useState<any>(albumItem ?? null);
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [isEnd, setIsEnd] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    // 局部搜索：对已加载部分按 歌名/歌手/专辑 过滤
    const search = useListSearch(musicList);
    const viewList = search.active ? search.filtered : musicList;

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        if (!albumItem) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        (async () => {
            const res = await tryPluginMethod<any>(
                pickSourcePlugins(plugins ?? [], "getAlbumInfo", sourceHash, albumItem),
                "getAlbumInfo",
                [albumItem, 1]);
            if (cancelled) {
                return;
            }
            if (res?.data) {
                setAlbumInfo(res.data.albumItem ?? albumItem);
                setMusicList(res.data.musicList ?? []);
                setIsEnd(!!res.data.isEnd || !(res.data.musicList ?? []).length);
            } else {
                setAlbumInfo(albumItem);
                setMusicList([]);
                setIsEnd(true);
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [albumItem, plugins, sourceHash]);

    const loadMore = async () => {
        if (!albumItem || loadingMore || isEnd) {
            return;
        }
        setLoadingMore(true);
        const next = page + 1;
        const res = await tryPluginMethod<any>(
            pickSourcePlugins(plugins ?? [], "getAlbumInfo", sourceHash, albumItem),
            "getAlbumInfo",
            [albumItem, next]);
        if (res?.data?.musicList?.length) {
            const fresh = res.data.musicList as IMusic.IMusicItem[];
            setMusicList((prev) => {
                const seen = new Set(prev.map((it) => `${it.platform}-${it.id}`));
                return [...prev, ...fresh.filter((it) => !seen.has(`${it.platform}-${it.id}`))];
            });
            setIsEnd(!!res.data.isEnd);
            setPage(next);
        } else {
            setIsEnd(true);
        }
        setLoadingMore(false);
    };

    if (!albumItem) {
        return <div className="page-empty">专辑不存在</div>;
    }

    const listId = `album:${albumItem.platform}-${albumItem.id}`;

    return (
        <div className="detail-page">
            <div className="detail-header">
                <Cover src={albumInfo?.artwork} className="detail-cover" radius={12} fallbackSize={56} />
                <div className="detail-header-info">
                    <div className="detail-title">{albumInfo?.title}</div>
                    <div className="detail-sub">
                        {[albumInfo?.artist, albumInfo?.date, albumInfo?.company]
                            .filter(Boolean)
                            .join(" · ")}
                    </div>
                    {albumInfo?.description && (
                        <div className="detail-desc">{albumInfo.description}</div>
                    )}
                    <div className="detail-actions">
                        <button
                            className="btn primary"
                            onClick={() => {
                                if (viewList.length) {
                                    TrackPlayerSingleton.playWithReplacePlayList(
                                        TrackPlayerSingleton.pickPlayAllStart(viewList),
                                        viewList,
                                        listId,
                                        true,
                                    );
                                }
                            }}
                            disabled={!musicList.length}
                        >
                            <IconPlay size={16} />
                            <span>播放全部</span>
                        </button>
                        <button
                            className="btn ghost"
                            disabled={!musicList.length}
                            onClick={() => search.setOpen(true)}
                        >
                            <IconSearch size={15} />
                            <span>搜索</span>
                        </button>
                    </div>
                </div>
            </div>

            {search.open && <ListSearchBar search={search} />}

            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : (
                <MusicList
                    musicList={viewList}
                    listId={listId}
                    onLoadMore={loadMore}
                    loadingMore={loadingMore}
                    isEnd={isEnd}
                />
            )}
        </div>
    );
}
