import { useEffect, useMemo, useState } from "react";
import { useCurrentRoute } from "@/core/router";
import { tryPluginMethod } from "@/core/pluginUtils";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { getPlugins } from "@/core/ipc";
import { TrackPlayerSingleton } from "@/core/trackPlayer";
import {
    getUserSheets,
    removeMusicFromSheetMany,
    type IUserSheet,
} from "@/core/musicSheet";
import MusicList from "@/components/base/MusicList";
import Cover from "@/components/base/Cover";
import ListSearchBar from "@/components/base/ListSearchBar";
import PlayAllBar from "@/components/base/PlayAllBar";
import SelectActionsBar from "@/components/base/SelectActionsBar";
import { IconPlay, IconSearch } from "@/components/base/Icons";
import { openAddToSheet } from "@/core/uiAtoms";
import { useListSearch } from "@/hooks/useListSearch";
import { useMusicMultiSelect } from "@/hooks/useMusicMultiSelect";

/**
 * 歌单详情页（三种来源）：
 *  - params.userSheetId：用户歌单（本地存储，支持移除/重命名/删除）
 *  - params.sheetItem：音源推荐歌单（getMusicSheetInfo 分页）
 *  - 由我的音乐进入的喜欢列表也走 userSheetId = my-likes
 */

export default function SheetDetailPage() {
    const route = useCurrentRoute();
    const userSheetId: string | undefined = route.params.userSheetId;
    const sheetItem: IMusic.IMusicSheetItemBase | undefined = route.params.sheetItem;
    const [plugins, setPlugins] = useState<any[] | null>(null);
    const sourceHash = useGlobalSource();

    // 用户歌单
    const [userSheet, setUserSheet] = useState<IUserSheet | null>(null);
    // 音源歌单
    const [remoteSheetInfo, setRemoteSheetInfo] = useState<any>(null);
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
        if (userSheetId) {
            const sheet = getUserSheets().find((it) => it.id === userSheetId) ?? null;
            setUserSheet(sheet);
            setMusicList(sheet?.musicList ?? []);
            setIsEnd(true);
            setLoading(false);
        }
    }, [userSheetId]);

    useEffect(() => {
        if (userSheetId || !sheetItem) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            const res = await tryPluginMethod<any>(
                pickSourcePlugins(plugins ?? [], "getMusicSheetInfo", sourceHash, sheetItem),
                "getMusicSheetInfo",
                [sheetItem, 1]);
            if (cancelled) {
                return;
            }
            if (res?.data) {
                setRemoteSheetInfo(res.data.sheetItem ?? sheetItem);
                setMusicList(res.data.musicList ?? []);
                setIsEnd(!!res.data.isEnd || !(res.data.musicList ?? []).length);
            } else {
                setRemoteSheetInfo(sheetItem);
                setMusicList([]);
                setIsEnd(true);
                setError("歌单加载失败");
            }
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userSheetId, sheetItem, plugins, sourceHash]);

    const loadMore = async () => {
        if (!sheetItem || loadingMore || isEnd) {
            return;
        }
        setLoadingMore(true);
        const next = page + 1;
        const res = await tryPluginMethod<any>(
            pickSourcePlugins(plugins ?? [], "getMusicSheetInfo", sourceHash, sheetItem),
            "getMusicSheetInfo",
            [sheetItem, next]);
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

    const info = userSheet ?? remoteSheetInfo;
    const subtitle = useMemo(() => {
        if (userSheet) {
            return `共 ${userSheet.musicList.length} 首`;
        }
        if (info?.worksNum) {
            return `共 ${info.worksNum} 首`;
        }
        return (info as any)?.creator ?? "";
    }, [userSheet, info]);

    // 局部搜索：过滤仅作用于列表视图与播放全部，原歌单数据不动
    const search = useListSearch(musicList);
    const viewList = search.active ? search.filtered : musicList;

    // 多选（收藏 / 用户歌单删除）；搜索时「全选」只选当前匹配结果，选中项仍按完整歌单校验
    const multi = useMusicMultiSelect(musicList, viewList);

    // 切换歌单时退出多选态与搜索态
    useEffect(() => {
        multi.exitSelect();
        search.close();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userSheetId, sheetItem]);

    if (!userSheetId && !sheetItem) {
        return <div className="page-empty">歌单不存在</div>;
    }

    const listId = userSheetId
        ? `usersheet:${userSheetId}`
        : `sheet:${sheetItem?.platform}-${sheetItem?.id}`;

    const playAll = () => {
        if (viewList.length) {
            TrackPlayerSingleton.playWithReplacePlayList(
                TrackPlayerSingleton.pickPlayAllStart(viewList),
                viewList,
                listId,
                true,
            );
        }
    };

    /** 从歌单移除（单首 / 多选批量） */
    const removeFromSheet = (items: IMusic.IMusicItem[]) => {
        if (!userSheetId) {
            return;
        }
        removeMusicFromSheetMany(userSheetId, items);
        const keys = new Set(items.map((it) => `${it.platform}-${it.id}`));
        setUserSheet((prev) =>
            prev
                ? {
                      ...prev,
                      musicList: prev.musicList.filter(
                          (it) => !keys.has(`${it.platform}-${it.id}`),
                      ),
                  }
                : prev,
        );
        setMusicList((prev) => prev.filter((it) => !keys.has(`${it.platform}-${it.id}`)));
    };

    return (
        <div className="detail-page">
            <div className="detail-header">
                <Cover src={info?.artwork} className="detail-cover" radius={12} fallbackSize={56} />
                <div className="detail-header-info">
                    <div className="detail-title">{info?.title ?? (loading ? "加载中…" : "未命名歌单")}</div>
                    <div className="detail-sub">{subtitle}</div>
                    {info?.description && <div className="detail-desc">{info.description}</div>}
                    <div className="detail-actions">
                        {multi.selectMode ? (
                            <PlayAllBar
                                count={viewList.length}
                                onPlayAll={playAll}
                                selectMode
                                selectedCount={multi.selected.length}
                                onExitSelect={multi.exitSelect}
                                onSelectAll={multi.selectAll}
                                onDeselectAll={multi.deselectAll}
                            />
                        ) : (
                            <>
                                <button className="btn primary" onClick={playAll} disabled={!musicList.length}>
                                    <IconPlay size={16} />
                                    <span>播放全部</span>
                                </button>
                                <button
                                    className="btn ghost"
                                    disabled={!musicList.length}
                                    onClick={() => openAddToSheet(musicList)}
                                >
                                    收藏全部
                                </button>
                                <button
                                    className="btn ghost"
                                    disabled={!musicList.length}
                                    onClick={() => search.setOpen(true)}
                                    title="搜索本歌单"
                                >
                                    <IconSearch size={15} />
                                    <span>搜索</span>
                                </button>
                                <button
                                    className="btn ghost"
                                    disabled={!musicList.length}
                                    onClick={multi.enterSelect}
                                >
                                    多选
                                </button>
                                {userSheetId && musicList.length > 0 && (
                                    <button
                                        className="btn ghost"
                                        onClick={() => {
                                            TrackPlayerSingleton.addNext(musicList);
                                        }}
                                    >
                                        全部下一首播放
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {search.open && <ListSearchBar search={search} />}

            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : error && !musicList.length ? (
                <div className="page-empty">{error}</div>
            ) : (
                <>
                    <MusicList
                        musicList={viewList}
                        listId={listId}
                        onLoadMore={userSheetId ? undefined : loadMore}
                        loadingMore={loadingMore}
                        isEnd={userSheetId ? true : isEnd}
                        selectMode={multi.selectMode}
                        selectedKeys={multi.selectedKeys}
                        onToggleSelect={multi.toggleSelect}
                        onRemoveItem={
                            userSheetId && !multi.selectMode
                                ? (item) => removeFromSheet([item])
                                : undefined
                        }
                    />
                    {multi.selectMode && (
                        <SelectActionsBar
                            count={multi.selected.length}
                            onCollect={multi.startCollect}
                            onDelete={
                                userSheetId ? () => multi.startDelete(removeFromSheet) : undefined
                            }
                        />
                    )}
                </>
            )}
        </div>
    );
}
