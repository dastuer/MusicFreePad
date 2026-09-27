import { useEffect, useState } from "react";
import { useCurrentRoute } from "@/core/router";
import { tryPluginMethod } from "@/core/pluginUtils";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { getPlugins } from "@/core/ipc";
import { TrackPlayerSingleton } from "@/core/trackPlayer";
import MusicList from "@/components/base/MusicList";
import Cover from "@/components/base/Cover";
import { IconPlay } from "@/components/base/Icons";

/** 排行榜详情页：getTopListDetail 分页加载 */
export default function TopListDetailPage() {
    const route = useCurrentRoute();
    const topListItem: IMusic.IMusicSheetItemBase | undefined = route.params.topListItem;
    const [plugins, setPlugins] = useState<any[] | null>(null);
    const sourceHash = useGlobalSource();
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [isEnd, setIsEnd] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        if (!topListItem) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            const res = await tryPluginMethod<any>(
                pickSourcePlugins(plugins ?? [], "getTopListDetail", sourceHash, topListItem),
                "getTopListDetail",
                [topListItem, 1]);
            if (cancelled) {
                return;
            }
            if (res?.data) {
                setMusicList(res.data.musicList ?? []);
                setIsEnd(!!res.data.isEnd || !(res.data.musicList ?? []).length);
            } else {
                setMusicList([]);
                setIsEnd(true);
                setError("排行榜加载失败");
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topListItem, plugins, sourceHash]);

    const loadMore = async () => {
        if (!topListItem || loadingMore || isEnd) {
            return;
        }
        setLoadingMore(true);
        const next = page + 1;
        const res = await tryPluginMethod<any>(
            pickSourcePlugins(plugins ?? [], "getTopListDetail", sourceHash, topListItem),
            "getTopListDetail",
            [topListItem, next]);
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

    if (!topListItem) {
        return <div className="page-empty">排行榜不存在</div>;
    }

    const listId = `toplist:${topListItem.platform}-${topListItem.id}`;

    return (
        <div className="detail-page">
            <div className="detail-header">
                <Cover src={topListItem.artwork} className="detail-cover" radius={12} fallbackSize={56} />
                <div className="detail-header-info">
                    <div className="detail-title">{topListItem.title}</div>
                    {topListItem.description && (
                        <div className="detail-desc">{topListItem.description}</div>
                    )}
                    <div className="detail-actions">
                        <button
                            className="btn primary"
                            onClick={() => {
                                if (musicList.length) {
                                    TrackPlayerSingleton.playWithReplacePlayList(
                                        TrackPlayerSingleton.pickPlayAllStart(musicList),
                                        musicList,
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
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : error && !musicList.length ? (
                <div className="page-empty">{error}</div>
            ) : (
                <MusicList
                    musicList={musicList}
                    listId={listId}
                    onLoadMore={loadMore}
                    loadingMore={loadingMore}
                    isEnd={isEnd}
                />
            )}
        </div>
    );
}
