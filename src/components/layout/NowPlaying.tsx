import { useEffect, useMemo, useRef, useState, type TransitionEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
    TrackPlayerSingleton,
    useCurrentMusic,
    useMusicState,
    useProgress,
    useRepeatMode,
    useVolume,
    useQuality,
    useRate,
    usePlayingQuality,
    useQualitySwitching,
    applyQuality,
    useCurrentLyric,
    loadCurrentLyric,
    currentLyricAtom,
    qualityRank,
} from "@/core/trackPlayer";
import { downloadMusic, getDownloadRecord } from "@/core/musicDownload";
import {
    nowPlayingOpenAtom,
    queueOpenAtom,
    openMusicActions,
    openAddToSheet,
    openAudioEffect,
    openSleepTimer,
    openSingleSelect,
    showToast,
    lyricTranslationAtom,
} from "@/core/uiAtoms";
import { useBackLayer } from "@/core/systemBack";
import { toggleLike, isLikedMusic, likesVersionAtom } from "@/core/musicSheet";
import { navigate } from "@/core/router";
import { formatSeconds, formatQualitySize } from "@/core/utils";
import Cover from "@/components/base/Cover";
import Slider from "@/components/base/Slider";
import VSlider from "@/components/base/VSlider";
import { QUALITY_LABEL, qualitySwitchToast } from "@/components/layout/PlayerBar";
import {
    IconChevronDown,
    IconPlay,
    IconPause,
    IconPrev,
    IconNext,
    IconHeart,
    IconQueue,
    IconRepeatOff,
    IconRepeatQueue,
    IconRepeatSingle,
    IconVolume,
    IconVolumeOff,
    IconMore,
} from "@/components/base/Icons";

/**
 * 正在播放浮层（网易云 Pad 风）：
 *  - 黑胶唱片 + 唱针（播放时唱片旋转、唱针落针，暂停时抬起）；
 *  - 横屏：左黑胶 + 右标题/歌词，操作区在左下；竖屏：标题/黑胶/歌词/操作区自上而下；
 *  - 底部三段式：操作行（喜欢/音质/音量/更多）、进度行、传输控制行（循环/上一首/播放/下一首/队列）。
 */

/** 音质档展示顺序 */
const QUALITY_ORDER: IMusic.IQualityKey[] = ["low", "standard", "high", "super"];
/** 倍速选项 */
const RATE_OPTIONS = [0.75, 1, 1.25, 1.5];

export default function NowPlaying() {
    const open = useAtomValue(nowPlayingOpenAtom);
    const setOpen = useSetAtom(nowPlayingOpenAtom);
    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const progress = useProgress();
    const repeatMode = useRepeatMode();
    const volume = useVolume();
    const quality = useQuality();
    const rate = useRate();
    const playingQuality = usePlayingQuality();
    const switchingQuality = useQualitySwitching();
    const lyric = useAtomValue(currentLyricAtom);
    const showTranslation = useAtomValue(lyricTranslationAtom);
    const likesVersion = useAtomValue(likesVersionAtom);
    const setQueueOpen = useSetAtom(queueOpenAtom);
    const [liked, setLiked] = useState<boolean | null>(null);
    const [volumePopupOpen, setVolumePopupOpen] = useState(false);
    const lyricRef = useRef<HTMLDivElement | null>(null);
    const activeLineRef = useRef<number>(-1);
    const volumePopRef = useRef<HTMLDivElement | null>(null);
    // 收起是一段离开视口的位移过渡，动画期间浮层要留在 DOM 里，故不直接按 open 卸载
    const [mounted, setMounted] = useState(false);
    const [revealed, setRevealed] = useState(false);
    void likesVersion;

    // 系统返回（Android 返回键 / iOS 侧滑）先收起本页，而不是退出应用
    useBackLayer(open, "nowplaying", () => setOpen(false));

    // 点弹层外任意位置收起音量弹层
    useEffect(() => {
        if (!volumePopupOpen) {
            return;
        }
        const onDocPointerDown = (e: PointerEvent) => {
            if (volumePopRef.current && !volumePopRef.current.contains(e.target as Node)) {
                setVolumePopupOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDocPointerDown, true);
        return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
    }, [volumePopupOpen]);

    useEffect(() => {
        if (!open) {
            setRevealed(false);
            return;
        }
        setMounted(true);
        // 先以收起位提交一帧，下一帧再展开：transition 需要已绘制的起始值才插值
        let inner = 0;
        const outer = requestAnimationFrame(() => {
            inner = requestAnimationFrame(() => setRevealed(true));
        });
        return () => {
            cancelAnimationFrame(outer);
            cancelAnimationFrame(inner);
        };
    }, [open]);

    useEffect(() => {
        if (!open) {
            setVolumePopupOpen(false);
        }
    }, [open]);

    useEffect(() => {
        if (open && currentMusic) {
            loadCurrentLyric(currentMusic);
        }
    }, [open, currentMusic]);

    // 歌词内容上下各预留约半个区域的边距：保证第一句/最后一句都能滚动到激活位置。
    // 边距加在内层包裹元素上，避免撑大 grid 项的最小内容高度导致轨道溢出页面
    useEffect(() => {
        const container = lyricRef.current;
        if (!open || !container) {
            return;
        }
        const applyPadding = () => {
            const inner = container.querySelector<HTMLElement>(".np-lyric-inner");
            const h = container.clientHeight;
            if (!inner || !h) {
                return;
            }
            const firstLine = container.querySelector<HTMLElement>(".np-lyric-line");
            const lineH = firstLine ? firstLine.offsetHeight : 40;
            // 首行滚到激活位（垂直居中上移一句）时 scrollTop 恰为 0；末行同理不被底边截住
            inner.style.paddingTop = `${Math.round(Math.max(0, h / 2 - lineH * 1.5))}px`;
            inner.style.paddingBottom = `${Math.round(h / 2 + lineH * 0.5)}px`;
        };
        applyPadding();
        const observer = new ResizeObserver(applyPadding);
        observer.observe(container);
        return () => observer.disconnect();
    }, [open, lyric.length]);

    const activeIndex = useMemo(() => {
        if (!lyric.length) {
            return -1;
        }
        let lo = 0;
        let hi = lyric.length - 1;
        let ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lyric[mid].time <= progress.position) {
                ans = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return ans;
    }, [lyric, progress.position]);

    useEffect(() => {
        if (activeIndex === activeLineRef.current) {
            return;
        }
        activeLineRef.current = activeIndex;
        const container = lyricRef.current;
        if (!container || activeIndex < 0) {
            return;
        }
        const el = container.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
        if (el) {
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            // 激活行定位：垂直居中的基础上再上移一句
            const anchorY = containerRect.height / 2 - elRect.height;
            const target =
                container.scrollTop + (elRect.top - containerRect.top) + elRect.height / 2 - anchorY;
            container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        }
    }, [activeIndex]);

    useEffect(() => {
        // 切歌后歌词滚动位置复位
        if (open && lyricRef.current) {
            lyricRef.current.scrollTop = 0;
            activeLineRef.current = -1;
        }
    }, [currentMusic, open]);

    if (!mounted || !currentMusic) {
        return null;
    }

    const playing = musicState === "playing";
    const loading = musicState === "loading";
    const isLiked = liked ?? isLikedMusic(currentMusic);
    const shownQuality = playingQuality ?? quality;

    const likeIt = () => {
        setLiked(toggleLike(currentMusic));
    };

    /** 当前歌曲支持的音质档（插件没报 qualities 时给全档） */
    const qualityOptions = () => {
        const supported = QUALITY_ORDER.filter((q) => currentMusic.qualities?.[q]);
        return (supported.length ? supported : QUALITY_ORDER).map((q) => ({
            value: q,
            label: QUALITY_LABEL[q],
            desc: formatQualitySize(currentMusic.qualities?.[q]?.size),
        }));
    };

    const openQualitySheet = () => {
        // 勾与徽标一致，都跟实际播放档走：本曲降级后（插件没有请求档 / 失败降档重试）
        // 请求档（quality）还在，实际播的是 playingQuality，勾要是还打在请求档上就和徽标对不上了
        const effectiveQuality = playingQuality ?? quality;
        openSingleSelect({
            title: "播放音质",
            subtitle: switchingQuality
                ? "正在缓冲新音质，当前播放不中断"
                : playingQuality && playingQuality !== quality
                  ? `当前音源按${QUALITY_LABEL[playingQuality]}播放，选择其他音质可重新尝试`
                  : undefined,
            options: qualityOptions(),
            value: effectiveQuality,
            onSelect: async (v) => {
                const next = v as IMusic.IQualityKey;
                const msg = qualitySwitchToast(await applyQuality(next), next);
                if (msg) {
                    showToast(msg);
                }
            },
        });
    };

    /** 下载音质面板：同档/更低提示跳过、更高提示覆盖（与列表下载入口同规则） */
    const openDownloadSheet = () => {
        const qualities: IMusic.IQualityKey[] = ["standard", "high", "super", "low"];
        const existing = getDownloadRecord(currentMusic)?.quality;
        openSingleSelect({
            title: "下载音质",
            options: qualities.map((q) => {
                let desc: string | undefined;
                if (existing) {
                    const rank = qualityRank(q) - qualityRank(existing);
                    if (rank < 0) {
                        desc = "已有更高音质，下载会跳过";
                    } else if (rank === 0) {
                        desc = "已下载，重复下载会跳过";
                    } else {
                        desc = "覆盖升级现有文件";
                    }
                }
                return { value: q, label: QUALITY_LABEL[q], desc };
            }),
            onSelect: (v) => {
                downloadMusic(currentMusic, v as IMusic.IQualityKey);
            },
        });
    };

    const openRateSheet = () => {
        openSingleSelect({
            title: "倍速播放",
            options: RATE_OPTIONS.map((r) => ({ value: String(r), label: `${r}x` })),
            value: String(rate),
            onSelect: (v) => {
                TrackPlayerSingleton.setRate(Number(v));
            },
        });
    };

    const openMoreActions = () => {
        const actions: { label: string; onClick: () => void; danger?: boolean }[] = [
            {
                label: "下一首播放",
                onClick: () => {
                    TrackPlayerSingleton.addNext(currentMusic);
                    showToast("已加入下一首播放");
                },
            },
            {
                label: "收藏到歌单",
                onClick: () => openAddToSheet([currentMusic]),
            },
        ];
        if (currentMusic.albumId !== undefined) {
            actions.push({
                label: "查看专辑",
                onClick: () => {
                    setOpen(false);
                    navigate("albumDetail", {
                        albumItem: {
                            id: currentMusic.albumId,
                            platform: currentMusic.platform,
                            title: currentMusic.album,
                            artwork: currentMusic.artwork,
                            artist: currentMusic.artist,
                        },
                    });
                },
            });
        }
        if (currentMusic.artistId !== undefined) {
            actions.push({
                label: "查看歌手",
                onClick: () => {
                    setOpen(false);
                    navigate("artistDetail", {
                        artistItem: {
                            id: currentMusic.artistId,
                            platform: currentMusic.platform,
                            name: currentMusic.artist,
                            avatar: currentMusic.artwork,
                        },
                    });
                },
            });
        }
        if (currentMusic.platform !== "local") {
            actions.push({ label: "下载", onClick: openDownloadSheet });
        }
        actions.push({ label: "音效", onClick: openAudioEffect });
        actions.push({ label: "倍速播放", onClick: openRateSheet });
        actions.push({ label: "定时关闭", onClick: openSleepTimer });
        openMusicActions({ musicItem: currentMusic, actions });
    };

    const onContentTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
        // 唱针、进度条等子元素的过渡会冒泡上来，只认浮层自己那一次位移
        if (e.target === e.currentTarget && !open) {
            setMounted(false);
        }
    };

    return (
        <div className={`nowplaying ${revealed ? "" : "np-closed"}`}>
            <div
                className="np-backdrop"
                style={currentMusic.artwork ? { backgroundImage: `url("${currentMusic.artwork}")` } : undefined}
            />
            <div className="np-mask" />
            <div className="np-content" onTransitionEnd={onContentTransitionEnd}>
                <div className="np-top">
                    <button className="icon-btn np-close" onClick={() => setOpen(false)}>
                        <IconChevronDown size={26} />
                    </button>
                </div>
                <div className="np-main">
                    <div className="np-header">
                        <div className="np-title">{currentMusic.title}</div>
                        <div className="np-artist">{currentMusic.artist}</div>
                    </div>

                    <div className="np-vinyl-wrap">
                        <div className="np-vinyl-box">
                            <div className={`np-vinyl ${playing ? "playing" : ""}`}>
                                <div className="np-vinyl-art">
                                    <Cover src={currentMusic.artwork} fallbackSize={64} />
                                </div>
                            </div>
                            <div className={`np-tonearm ${playing ? "on" : ""}`}>
                                <div className="np-tonearm-base" />
                                <div className="np-tonearm-arm" />
                            </div>
                        </div>
                    </div>

                    <div className="np-lyric" ref={lyricRef}>
                        <div className="np-lyric-inner">
                            {lyric.length ? (
                                lyric.map((line, idx) => (
                                    <div
                                        key={idx}
                                        data-line={idx}
                                        className={`np-lyric-line ${idx === activeIndex ? "active" : ""}`}
                                        onClick={() => {
                                            TrackPlayerSingleton.seekTo(line.time);
                                            // 暂停中点歌词：跳转进度并继续播放
                                            if (musicState === "paused" || musicState === "stopped") {
                                                TrackPlayerSingleton.togglePlay();
                                            }
                                        }}
                                    >
                                        {line.lrc || "···"}
                                        {showTranslation && line.translation && (
                                            <div className="np-lyric-trans">{line.translation}</div>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="np-lyric-empty">暂无歌词</div>
                            )}
                        </div>
                    </div>

                    <div className="np-footer">
                        <div className="np-actions">
                            <button
                                className={`icon-btn np-action-btn ${isLiked ? "liked" : ""}`}
                                onClick={likeIt}
                                title={isLiked ? "取消喜欢" : "喜欢"}
                            >
                                <IconHeart size={22} filled={isLiked} />
                            </button>
                            <div className="quality-wrap">
                                <button
                                    className={`quality-badge np-quality-badge ${
                                        switchingQuality ? "switching" : ""
                                    }`}
                                    onClick={openQualitySheet}
                                    title={switchingQuality ? "正在缓冲新音质，当前播放不中断" : "音质"}
                                >
                                    {QUALITY_LABEL[shownQuality]}
                                </button>
                            </div>
                            <div className="np-volume-anchor" ref={volumePopRef}>
                                <button
                                    className={`icon-btn np-action-btn np-volume-btn ${volumePopupOpen ? "open" : ""}`}
                                    onClick={() => setVolumePopupOpen((v) => !v)}
                                    title="音量"
                                >
                                    {volume > 0 ? <IconVolume size={20} /> : <IconVolumeOff size={20} />}
                                </button>
                                {volumePopupOpen && (
                                    <div className="np-volume-pop">
                                        <VSlider
                                            value={volume}
                                            max={1}
                                            height={110}
                                            onInput={(v) => TrackPlayerSingleton.setVolume(v)}
                                            onCommit={(v) => TrackPlayerSingleton.setVolume(v)}
                                        />
                                        <span className="np-volume-pop-value">
                                            {Math.round(volume * 100)}%
                                        </span>
                                    </div>
                                )}
                            </div>
                            <button
                                className="icon-btn np-action-btn"
                                onClick={openMoreActions}
                                title="更多操作"
                            >
                                <IconMore size={22} />
                            </button>
                        </div>

                        <div className="np-progress-row">
                            <span className="np-time">{formatSeconds(progress.position)}</span>
                            <Slider
                                value={progress.position}
                                max={progress.duration || currentMusic.duration || 0}
                                onCommit={(v) => TrackPlayerSingleton.seekTo(v)}
                                className="np-slider"
                            />
                            <span className="np-time">
                                {formatSeconds(progress.duration || currentMusic.duration)}
                            </span>
                        </div>

                        <div className="np-transport">
                            <button
                                className="icon-btn"
                                onClick={() => TrackPlayerSingleton.toggleRepeatMode()}
                                title={
                                    repeatMode === "off"
                                        ? "顺序播放"
                                        : repeatMode === "queue"
                                          ? "随机播放"
                                          : "单曲循环"
                                }
                            >
                                {repeatMode === "off" ? (
                                    <IconRepeatOff size={22} />
                                ) : repeatMode === "queue" ? (
                                    <IconRepeatQueue size={22} />
                                ) : (
                                    <IconRepeatSingle size={22} />
                                )}
                            </button>
                            <button className="icon-btn" onClick={() => TrackPlayerSingleton.skipToPrevious()}>
                                <IconPrev size={22} />
                            </button>
                            <button
                                className="np-play"
                                onClick={() => TrackPlayerSingleton.togglePlay()}
                            >
                                {loading ? (
                                    <span className="spinner" />
                                ) : playing ? (
                                    <IconPause size={28} />
                                ) : (
                                    <IconPlay size={28} />
                                )}
                            </button>
                            <button className="icon-btn" onClick={() => TrackPlayerSingleton.skipToNext()}>
                                <IconNext size={22} />
                            </button>
                            <button
                                className="icon-btn"
                                onClick={() => {
                                    setOpen(false);
                                    setQueueOpen(true);
                                }}
                                title="播放队列"
                            >
                                <IconQueue size={22} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
