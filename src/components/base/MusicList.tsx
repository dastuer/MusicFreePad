import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useAtomValue } from "jotai";
import Cover from "./Cover";
import {
    TrackPlayerSingleton,
    useCurrentMusic,
    useMusicState,
} from "@/core/trackPlayer";
import { openMusicActions } from "@/core/uiAtoms";
import { toggleLike, isLikedMusic, likesVersionAtom } from "@/core/musicSheet";
import { navigate } from "@/core/router";
import { formatSeconds } from "@/core/utils";
import { IconHeart, IconMore, IconPlaying } from "./Icons";

/**
 * 歌曲列表（Pad 形态）：序号/播放中动画、封面、歌名+歌手、专辑（宽屏）、时长、红心、更多。
 * 渐进渲染（每次 150 行），点行整队替换播放。
 * 传入 onLoadMore 后滚动到底部自动加载下一页。
 */

const RENDER_STEP = 150;
/** 滑动超过该距离视为滚动手势，吞掉手势结束时的 click，避免滑动列表时误触歌曲 */
const TOUCH_MOVE_THRESHOLD = 8;
/** 手指抬起后仍处于惯性滚动时（最近一次滚动事件在该窗口内），吞掉 click（“点一下停住滚动”不应选中歌曲） */
const RECENT_SCROLL_WINDOW = 300;

export default function MusicList({
    musicList,
    listId,
    onRemoveItem,
    showIndex = true,
    className = "",
    onLoadMore,
    loadingMore = false,
    isEnd = true,
    showEndHint = true,
}: {
    musicList: IMusic.IMusicItem[];
    listId: string;
    onRemoveItem?: (item: IMusic.IMusicItem) => void;
    showIndex?: boolean;
    className?: string;
    onLoadMore?: () => void;
    loadingMore?: boolean;
    isEnd?: boolean;
    showEndHint?: boolean;
}) {
    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const likesVersion = useAtomValue(likesVersionAtom);
    const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(RENDER_STEP);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const dataSentinelRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const suppressClickRef = useRef(false);
    const lastTouchEndRef = useRef(0);
    const lastScrollTsRef = useRef(0);

    // 只在切换列表（listId 变化）时重置渐进渲染进度；追加数据时保持已展开的行数，避免滚动位置塌陷
    useEffect(() => {
        setVisibleCount(RENDER_STEP);
    }, [listId]);

    // 已喜欢的集合（一次性算好，红心不再逐行读 localStorage）
    useEffect(() => {
        void likesVersion;
        const set = new Set(
            musicList
                .filter((it) => isLikedMusic(it))
                .map((it) => `${it.platform}-${it.id}`),
        );
        setLikedSet(set);
    }, [musicList, likesVersion]);

    // 渐进渲染：滚动到底部附近时再多渲染一批
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setVisibleCount((c) => Math.min(c + RENDER_STEP, musicList.length));
                }
            },
            { rootMargin: "400px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [musicList.length]);

    // 自动加载更多：哨兵进入视口下方 600px 时拉取下一页；
    // items 变化时重新 observe，若哨兵仍在视口内会立刻再触发，从而连续加载直到铺满
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;
    useEffect(() => {
        const el = dataSentinelRef.current;
        if (!el || !onLoadMore) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    onLoadMoreRef.current?.();
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onLoadMore != null, isEnd, musicList.length]);

    // 滑动手势期间/惯性滚动未停时，吞掉行的 click（触屏上“滑动列表”不应触发歌曲）
    useEffect(() => {
        const el = listRef.current;
        if (!el) {
            return;
        }
        let startX = 0;
        let startY = 0;
        const onTouchStart = (e: TouchEvent) => {
            suppressClickRef.current = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (suppressClickRef.current) {
                return;
            }
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (dx * dx + dy * dy > TOUCH_MOVE_THRESHOLD * TOUCH_MOVE_THRESHOLD) {
                suppressClickRef.current = true;
            }
        };
        const onTouchEnd = () => {
            lastTouchEndRef.current = Date.now();
        };
        const onScroll = () => {
            lastScrollTsRef.current = Date.now();
        };
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        // capture：滚动容器是外层 .page-container，也能监听到它的滚动
        document.addEventListener("scroll", onScroll, true);
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, []);

    const onClickCapture = (e: ReactMouseEvent) => {
        const touchClick = Date.now() - lastTouchEndRef.current < RECENT_SCROLL_WINDOW;
        if (
            touchClick &&
            (suppressClickRef.current ||
                Date.now() - lastScrollTsRef.current < RECENT_SCROLL_WINDOW)
        ) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickRef.current = false;
        }
    };

    const visible = musicList.slice(0, visibleCount);

    const onRowClick = (item: IMusic.IMusicItem) => {
        TrackPlayerSingleton.playWithReplacePlayList(item, musicList, listId);
    };

    const buildActions = (item: IMusic.IMusicItem) => {
        const liked = likedSet.has(`${item.platform}-${item.id}`);
        const actions = [] as any[];
        actions.push({
            label: "下一首播放",
            onClick: () => TrackPlayerSingleton.addNext(item),
        });
        actions.push({
            label: liked ? "取消喜欢" : "喜欢",
            onClick: () => {
                const nowLiked = toggleLike(item);
                setLikedSet((prev) => {
                    const next = new Set(prev);
                    if (nowLiked) {
                        next.add(`${item.platform}-${item.id}`);
                    } else {
                        next.delete(`${item.platform}-${item.id}`);
                    }
                    return next;
                });
            },
        });
        if (item.albumId !== undefined) {
            actions.push({
                label: "查看专辑",
                onClick: () =>
                    navigate("albumDetail", {
                        albumItem: {
                            id: item.albumId,
                            platform: item.platform,
                            title: item.album,
                            artwork: item.artwork,
                            artist: item.artist,
                        },
                    }),
            });
        }
        if (onRemoveItem) {
            actions.push({
                label: "移出本列表",
                danger: true,
                onClick: () => onRemoveItem(item),
            });
        }
        return actions;
    };

    return (
        <div
            ref={listRef}
            className={`music-list ${className}`}
            onClickCapture={onClickCapture}
        >
            {visible.map((item, idx) => {
                const isCurrent =
                    currentMusic?.id === item.id && currentMusic?.platform === item.platform;
                const liked = likedSet.has(`${item.platform}-${item.id}`);
                return (
                    <div
                        key={`${item.platform}-${item.id}-${idx}`}
                        className={`music-row ${isCurrent ? "current" : ""}`}
                        onClick={() => onRowClick(item)}
                    >
                        <div className="music-row-index">
                            {isCurrent && musicState === "playing" ? (
                                <IconPlaying size={16} />
                            ) : showIndex ? (
                                <span className="row-num">{idx + 1}</span>
                            ) : null}
                        </div>
                        <Cover src={item.artwork} size={44} radius={6} className="music-row-cover" />
                        <div className="music-row-info">
                            <div className="music-row-title">{item.title}</div>
                            <div className="music-row-sub">
                                {item.artist}
                                {item.album ? ` · ${item.album}` : ""}
                            </div>
                        </div>
                        <div className="music-row-album">{item.album}</div>
                        <div className="music-row-actions">
                            <button
                                className={`icon-btn like-btn ${liked ? "liked" : ""}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const nowLiked = toggleLike(item);
                                    setLikedSet((prev) => {
                                        const next = new Set(prev);
                                        if (nowLiked) {
                                            next.add(`${item.platform}-${item.id}`);
                                        } else {
                                            next.delete(`${item.platform}-${item.id}`);
                                        }
                                        return next;
                                    });
                                }}
                                title={liked ? "取消喜欢" : "喜欢"}
                            >
                                <IconHeart size={17} filled={liked} />
                            </button>
                            <span className="music-row-duration">
                                {formatSeconds(item.duration)}
                            </span>
                            <button
                                className="icon-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openMusicActions({
                                        musicItem: item,
                                        actions: buildActions(item),
                                    });
                                }}
                                title="更多操作"
                            >
                                <IconMore size={17} />
                            </button>
                        </div>
                    </div>
                );
            })}
            {visibleCount < musicList.length && (
                <div ref={sentinelRef} className="music-list-sentinel" />
            )}
            {onLoadMore && !isEnd && musicList.length > 0 && (
                <div ref={dataSentinelRef} className="music-list-sentinel" />
            )}
            {onLoadMore && loadingMore && (
                <div className="music-list-loading">
                    <span className="spinner" />
                    <span>加载中…</span>
                </div>
            )}
            {onLoadMore && isEnd && showEndHint && musicList.length > 0 && (
                <div className="list-end-hint">没有更多了</div>
            )}
        </div>
    );
}
