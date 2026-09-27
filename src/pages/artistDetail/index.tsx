import { useEffect, useState } from "react";
import { useCurrentRoute } from "@/core/router";
import { tryPluginMethod } from "@/core/pluginUtils";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { getPlugins } from "@/core/ipc";
import MusicList from "@/components/base/MusicList";
import SheetCardGrid from "@/components/base/SheetCardGrid";
import Cover from "@/components/base/Cover";
import { navigate } from "@/core/router";

/** 歌手详情页：getArtistWorks，单曲/专辑两个标签 */
export default function ArtistDetailPage() {
    const route = useCurrentRoute();
    const artistItem: IArtist.IArtistItemBase | undefined = route.params.artistItem;
    const [plugins, setPlugins] = useState<any[] | null>(null);
    const sourceHash = useGlobalSource();
    const [worksType, setWorksType] = useState<"music" | "album">("music");
    const [musicList, setMusicList] = useState<IMusic.IMusicItem[]>([]);
    const [albums, setAlbums] = useState<IAlbum.IAlbumItemBase[]>([]);
    const [isEnd, setIsEnd] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        if (!artistItem) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setMusicList([]);
        setAlbums([]);
        setIsEnd(false);
        setPage(1);
        (async () => {
            const res = await tryPluginMethod<any>(
                pickSourcePlugins(plugins ?? [], "getArtistWorks", sourceHash, artistItem),
                "getArtistWorks",
                [artistItem, 1, worksType],
            );
            if (cancelled) {
                return;
            }
            if (res?.data) {
                const data = res.data.data ?? [];
                if (worksType === "music") {
                    setMusicList(data);
                } else {
                    setAlbums(data);
                }
                setIsEnd(!!res.data.isEnd || !data.length);
            } else {
                setIsEnd(true);
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artistItem, plugins, sourceHash, worksType]);

    const loadMore = async () => {
        if (!artistItem || loadingMore || isEnd) {
            return;
        }
        setLoadingMore(true);
        const next = page + 1;
        const res = await tryPluginMethod<any>(
            pickSourcePlugins(plugins ?? [], "getArtistWorks", sourceHash, artistItem),
            "getArtistWorks",
            [artistItem, next, worksType],
        );
        if (res?.data?.data?.length) {
            const data = res.data.data as any[];
            if (worksType === "music") {
                setMusicList((prev) => {
                    const seen = new Set(prev.map((it) => `${it.platform}-${it.id}`));
                    return [...prev, ...data.filter((it) => !seen.has(`${it.platform}-${it.id}`))];
                });
            } else {
                setAlbums((prev) => {
                    const seen = new Set(prev.map((it) => `${it.platform}-${it.id}`));
                    return [...prev, ...data.filter((it) => !seen.has(`${it.platform}-${it.id}`))];
                });
            }
            setIsEnd(!!res.data.isEnd);
            setPage(next);
        } else {
            setIsEnd(true);
        }
        setLoadingMore(false);
    };

    if (!artistItem) {
        return <div className="page-empty">歌手不存在</div>;
    }

    return (
        <div className="detail-page">
            <div className="detail-header">
                <Cover
                    src={artistItem.avatar}
                    className="detail-cover"
                    radius={"50%"}
                    size={140}
                    fallbackSize={56}
                />
                <div className="detail-header-info">
                    <div className="detail-title">{artistItem.name}</div>
                    {artistItem.description && (
                        <div className="detail-desc">{artistItem.description}</div>
                    )}
                </div>
            </div>

            <div className="page-toolbar">
                <div className="seg-tabs">
                    <button
                        className={`seg-tab ${worksType === "music" ? "active" : ""}`}
                        onClick={() => setWorksType("music")}
                    >
                        单曲
                    </button>
                    <button
                        className={`seg-tab ${worksType === "album" ? "active" : ""}`}
                        onClick={() => setWorksType("album")}
                    >
                        专辑
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : worksType === "music" ? (
                <MusicList
                    musicList={musicList}
                    listId={`artist:${artistItem.platform}-${artistItem.id}`}
                    onLoadMore={worksType === "music" ? loadMore : undefined}
                    loadingMore={loadingMore}
                    isEnd={isEnd}
                />
            ) : (
                <div className="album-grid">
                    {albums.map((album, idx) => (
                        <div
                            key={`${album.platform}-${album.id}-${idx}`}
                            className="album-card"
                            onClick={() => navigate("albumDetail", { albumItem: album })}
                        >
                            <Cover src={album.artwork} radius={10} className="album-card-img" />
                            <div className="sheet-card-title">{album.title}</div>
                            <div className="sheet-card-sub">{album.date ?? album.artist}</div>
                        </div>
                    ))}
                </div>
            )}
            {!isEnd && worksType === "album" && albums.length > 0 && (
                <div className="load-more">
                    <button className="btn ghost" disabled={loadingMore} onClick={loadMore}>
                        {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                </div>
            )}
        </div>
    );
}
