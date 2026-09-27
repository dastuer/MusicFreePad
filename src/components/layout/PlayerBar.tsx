import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
    TrackPlayerSingleton,
    useCurrentMusic,
    useMusicState,
    useProgress,
    useRepeatMode,
    useQuality,
    usePlayingQuality,
    applyQuality,
} from "@/core/trackPlayer";
import { toggleLike, isLikedMusic, likesVersionAtom } from "@/core/musicSheet";
import { nowPlayingOpenAtom, queueOpenAtom, showToast } from "@/core/uiAtoms";
import { formatSeconds } from "@/core/utils";
import Cover from "@/components/base/Cover";
import Slider from "@/components/base/Slider";
import {
    IconPlay,
    IconPause,
    IconPrev,
    IconNext,
    IconHeart,
    IconQueue,
    IconRepeatOff,
    IconRepeatQueue,
    IconRepeatSingle,
} from "@/components/base/Icons";

export const QUALITY_LABEL: Record<IMusic.IQualityKey, string> = {
    low: "低品",
    standard: "标准",
    high: "高品",
    super: "无损",
};

/** 底部播放条（网易云 Pad 风）：封面 | 播放控制 | 歌名+进度条+进度 | 红心/音质/循环/队列 */
export default function PlayerBar() {
    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const progress = useProgress();
    const repeatMode = useRepeatMode();
    const quality = useQuality();
    const playingQuality = usePlayingQuality();
    const likesVersion = useAtomValue(likesVersionAtom);
    const setNowPlayingOpen = useSetAtom(nowPlayingOpenAtom);
    const setQueueOpen = useSetAtom(queueOpenAtom);
    const [liked, setLiked] = useState<boolean | null>(null);
    const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
    void likesVersion;

    if (!currentMusic) {
        return (
            <div className="playerbar playerbar-empty">
                <div className="playerbar-hint">试听一首歌吧，从「发现」挑个歌单开始</div>
            </div>
        );
    }

    const isLiked = liked ?? isLikedMusic(currentMusic);
    const playing = musicState === "playing";
    const loading = musicState === "loading";
    const shownQuality = playingQuality ?? quality;
    const likeIt = () => {
        setLiked(toggleLike(currentMusic));
    };
    const openNowPlaying = () => setNowPlayingOpen(true);

    return (
        <div className="playerbar">
            <div className="playerbar-main">
                <div className="playerbar-cover" onClick={openNowPlaying}>
                    <Cover src={currentMusic.artwork} size={46} radius={8} />
                </div>

                <div className="playerbar-controls">
                    <button className="icon-btn" onClick={() => TrackPlayerSingleton.skipToPrevious()}>
                        <IconPrev size={22} />
                    </button>
                    <button
                        className="playerbar-play"
                        onClick={() => TrackPlayerSingleton.togglePlay()}
                    >
                        {loading ? <span className="spinner" /> : playing ? (
                            <IconPause size={24} />
                        ) : (
                            <IconPlay size={24} />
                        )}
                    </button>
                    <button className="icon-btn" onClick={() => TrackPlayerSingleton.skipToNext()}>
                        <IconNext size={22} />
                    </button>
                </div>

                <div className="playerbar-center">
                    <div className="playerbar-meta" onClick={openNowPlaying}>
                        <span className="playerbar-title">{currentMusic.title}</span>
                        <span className="playerbar-time">
                            {formatSeconds(progress.position)} / {formatSeconds(progress.duration || currentMusic.duration)}
                        </span>
                    </div>
                    <Slider
                        value={progress.position}
                        max={progress.duration || currentMusic.duration || 0}
                        onCommit={(v) => TrackPlayerSingleton.seekTo(v)}
                        className="playerbar-slider"
                    />
                </div>

                <div className="playerbar-right">
                    <button
                        className={`icon-btn ${isLiked ? "liked" : ""}`}
                        onClick={likeIt}
                        title={isLiked ? "取消喜欢" : "喜欢"}
                    >
                        <IconHeart size={19} filled={isLiked} />
                    </button>
                    <div className="quality-wrap">
                        <button
                            className="quality-badge"
                            onClick={() => setQualityMenuOpen((v) => !v)}
                        >
                            {QUALITY_LABEL[shownQuality]}
                        </button>
                        {qualityMenuOpen && (
                            <div className="quality-menu">
                                {(Object.keys(QUALITY_LABEL) as IMusic.IQualityKey[]).map((q) => (
                                    <div
                                        key={q}
                                        className={`quality-item ${q === quality ? "selected" : ""}`}
                                        onClick={async () => {
                                            setQualityMenuOpen(false);
                                            if (q !== quality) {
                                                await applyQuality(q);
                                                showToast(`音质已切换为${QUALITY_LABEL[q]}`);
                                            }
                                        }}
                                    >
                                        {QUALITY_LABEL[q]}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
                            <IconRepeatOff size={19} />
                        ) : repeatMode === "queue" ? (
                            <IconRepeatQueue size={19} />
                        ) : (
                            <IconRepeatSingle size={19} />
                        )}
                    </button>
                    <button
                        className="icon-btn"
                        onClick={() => setQueueOpen(true)}
                        title="播放队列"
                    >
                        <IconQueue size={19} />
                    </button>
                </div>
            </div>
        </div>
    );
}
