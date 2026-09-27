import { atom, getDefaultStore, useAtomValue } from "jotai";
import EventEmitter from "eventemitter3";
import { buildPlayableMediaUrl } from "./net";
import { getPluginByMedia, pluginCall } from "./ipc";
import { setMusicHistory } from "./musicHistory";
import { getQuality, setQuality, getConfig } from "./appConfig";

export type MusicState = "playing" | "paused" | "stopped" | "loading";
export type MusicRepeatMode = "off" | "queue" | "single";

/**
 * 内联封面尺寸上限。超过就认为它是"整张图塞成 base64"，
 * 不该进 localStorage、也不该交给 MediaMetadata（与桌面端同规则）。
 */
const MAX_PERSISTED_ARTWORK = 64 * 1024;

export const enum TrackPlayerEvents {
    PlayEnd = "PlayEnd",
    CurrentMusicChanged = "CurrentMusicChanged",
    ProgressChanged = "ProgressChanged",
    StateChanged = "StateChanged",
    /** 音源解析 / 音频加载失败（payload 见 IPlayFailurePayload） */
    PlayFailed = "PlayFailed",
}

/** 播放失败事件的载荷 */
export interface IPlayFailurePayload {
    musicItem: IMusic.IMusicItem;
    reason: string;
    willSkip: boolean;
    downgradedTo?: IMusic.IQualityKey;
}

/**
 * 单次 getMediaSource 的最长等待。
 * 换歌时旧歌已经被停掉，等待期是静音的，所以不能让一个卡死的音源拖满 pluginCall 的 30s。
 */
const MEDIA_SOURCE_TIMEOUT = 10000;

/** 连续 N 首都播不出来就停下，不再自动往后跳（否则坏音源会把整个歌单空转一圈） */
const MAX_AUTO_SKIP = 3;

/** 本曲内音质降级重试的上限 */
const MAX_QUALITY_RETRY = 3;

/** 播放历史留多少首（上一首按它回退） */
const MAX_HISTORY = 50;

/** 「记忆播放进度」的最小起播位置 / 结尾间隔（与桌面端 playProgress 同规则） */
const MIN_REMEMBER_POSITION = 5;
const END_GAP = 5;

/**
 * 队列里认一首歌用的键。与 `musicSheet` 的 `mediaKey` 同一约定。
 */
function playListKey(musicItem: IMusic.IMusicItem) {
    return `${musicItem.platform}-${musicItem.id}`;
}

/** 能进播放队列吗：得有 id（去重和增删都按它认） */
function isQueueable(musicItem?: IMusic.IMusicItem | null) {
    return !!musicItem?.id && !musicItem.localPath?.startsWith?.("tmp");
}

/** 把一份列表整理成能进播放队列的样子：没有 id 的丢掉，同一首只留第一份。 */
function toQueueableList(musicItems: IMusic.IMusicItem[]) {
    const seen = new Set<string>();
    return musicItems.filter((it) => {
        if (!isQueueable(it) || seen.has(playListKey(it))) {
            return false;
        }
        seen.add(playListKey(it));
        return true;
    });
}

/** MediaError 转成人话（见 HTMLMediaElement.error） */
function describeMediaError(err?: MediaError | null) {
    switch (err?.code) {
        case 1:
            return "音频加载被中断";
        case 2:
            return "音频流网络中断";
        case 3:
            return "音频解码失败";
        case 4:
            return "音源返回的音频无法播放（链接可能已失效）";
        default:
            return "音频加载失败";
    }
}

/** play() 抛出的异常转成人话 */
function describePlayError(e: any) {
    if (e?.name === "NotSupportedError") {
        return "音源返回的音频无法播放（链接可能已失效）";
    }
    if (e?.name === "NotAllowedError") {
        return "浏览器未允许自动播放";
    }
    if (e?.name === "AbortError") {
        return "播放被新的请求中断";
    }
    return e?.message ?? String(e ?? "未知原因");
}

/** 音质档位从低到高：对齐与降级都按这个顺序 */
const QUALITY_LADDER: IMusic.IQualityKey[] = ["low", "standard", "high", "super"];

/**
 * 条目声明了可用音质（`qualities`）时对齐请求档（与桌面端同规则）。
 */
function pickSupportedQuality(
    requested: IMusic.IQualityKey,
    qualities?: IMusic.IQuality,
): IMusic.IQualityKey | null {
    if (!qualities || typeof qualities !== "object") {
        return null;
    }
    const supported = QUALITY_LADDER.filter((q) => qualities[q]);
    if (!supported.length) {
        return null;
    }
    const reqIdx = QUALITY_LADDER.indexOf(requested);
    const atOrBelow = supported.filter((q) => QUALITY_LADDER.indexOf(q) <= reqIdx);
    return atOrBelow.length ? atOrBelow[atOrBelow.length - 1] : supported[0];
}

/** 解析音源用的音质尝试序列：从起始档逐级下降，最多 3 档 */
function resolveQualityLadder(first: IMusic.IQualityKey): IMusic.IQualityKey[] {
    const idx = QUALITY_LADDER.indexOf(first);
    const ladder = QUALITY_LADDER.slice(0, idx + 1).reverse();
    if (!ladder.includes("standard")) {
        ladder.push("standard");
    }
    return ladder.slice(0, 3);
}

/** ---------- jotai atoms ---------- */
export const DEFAULT_VOLUME = 0.8;

function getStoredVolume(): number {
    const raw = localStorage.getItem("volume");
    if (raw === null) {
        return DEFAULT_VOLUME;
    }
    const stored = Number(raw);
    return Number.isFinite(stored) ? Math.min(Math.max(stored, 0), 1) : DEFAULT_VOLUME;
}

export const playListAtom = atom<IMusic.IMusicItem[]>([]);
export const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
export const musicStateAtom = atom<MusicState>("stopped");
export const repeatModeAtom = atom<MusicRepeatMode>("off");
export const progressAtom = atom<{ position: number; duration: number }>({
    position: 0,
    duration: 0,
});
export const rateAtom = atom<number>(1);
export const volumeAtom = atom<number>(getStoredVolume());
export const qualityAtom = atom<IMusic.IQualityKey>(getQuality());
export const playingQualityAtom = atom<IMusic.IQualityKey | null>(null);
export const playListAddedAtom = atom(0);

const store = getDefaultStore();

function setAtom<T>(atom_: any, value: T) {
    store.set(atom_, value);
}

/** ---------- 播放进度记忆 ---------- */

export interface IPlayProgressRecord {
    music: IMusic.IMusicItem;
    position: number;
    duration: number;
    updatedAt: number;
}

const PROGRESS_KEY = "playProgress";

function isRememberProgressEnabled(): boolean {
    return getConfig("rememberProgress", true) !== false;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function slimMusic(musicItem: IMusic.IMusicItem): IMusic.IMusicItem {
    return typeof musicItem.artwork === "string" && musicItem.artwork.length > MAX_PERSISTED_ARTWORK
        ? { ...musicItem, artwork: "" }
        : musicItem;
}

function getStoredProgress(): IPlayProgressRecord | null {
    try {
        const raw = localStorage.getItem(PROGRESS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.music?.platform && parsed?.music?.id) {
            return parsed;
        }
    } catch {
        // ignore
    }
    return null;
}

function getStoredCurrentMusic(): IMusic.IMusicItem | null {
    try {
        const raw = localStorage.getItem("currentMusic");
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed?.platform && parsed?.id ? parsed : null;
    } catch {
        return null;
    }
}

/** ---------- 播放器 ---------- */

class TrackPlayer extends EventEmitter {
    private audio: HTMLAudioElement | null = null;
    private _repeatMode: MusicRepeatMode = "off";
    private _playList: IMusic.IMusicItem[] = [];
    /** 当前队列是哪份列表装进来的（整队替换标识，重启时跟着队列一起还原） */
    private _currentListId = "";
    /** 播过的歌，按播放顺序，最后一项就是当前这首。 */
    private _history: IMusic.IMusicItem[] = [];
    /** 「下一首播放」压进来的歌，`playListKey` 按登记先后排列。只在内存里。 */
    private _pendingNext: string[] = [];
    private _currentMusic: IMusic.IMusicItem | null = null;
    private _rate = 1;
    private pendingPlayId = "";
    private isLoading = false;
    private autoSkipCount = 0;
    private autoSkipping = false;
    private playSeq = 0;
    private stallTimer: ReturnType<typeof setTimeout> | null = null;
    private stallNudges = 0;
    private pendingSeekListener: (() => void) | null = null;
    private pendingStartPosition = 0;
    private resolvedQuality: IMusic.IQualityKey | null = null;
    private resolvedSourceUrl: string | null = null;
    private qualityRetrying = false;
    private qualityRetryCount = 0;

    setup() {
        if (this.audio) {
            return;
        }
        const audio = new Audio();
        audio.preload = "auto";
        audio.volume = getStoredVolume();
        audio.addEventListener("ended", this.onEnded);
        audio.addEventListener("timeupdate", this.onProgress);
        audio.addEventListener("loadedmetadata", this.onProgress);
        audio.addEventListener("pause", this.onAudioPause);
        audio.addEventListener("play", this.onAudioPlay);
        audio.addEventListener("playing", this.onAudioPlaying);
        audio.addEventListener("error", this.onAudioError);
        audio.addEventListener("waiting", this.onAudioStall);
        audio.addEventListener("stalled", this.onAudioStall);
        this.audio = audio;

        // Pad 版：切后台 / 关页面前把「听到哪儿」写进 localStorage（桌面端是退出握手写 session.json）
        const persist = () => this.persistProgress();
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                persist();
            }
        });
        window.addEventListener("pagehide", persist);

        this.restoreSession();
    }

    /**
     * 还原「上次播放会话」：队列 + 当前歌 + 进度，全部来自 localStorage。
     * 只改状态与 atom，不自动出声（要不要接着听由用户按播放决定）。
     */
    private restoreSession() {
        try {
            let playList: IMusic.IMusicItem[] | null = null;
            try {
                const raw = localStorage.getItem("playList");
                const parsed = raw ? JSON.parse(raw) : null;
                if (Array.isArray(parsed) && parsed.length) {
                    playList = parsed;
                }
            } catch {
                // ignore
            }
            if (playList?.length) {
                this._playList = toQueueableList(playList);
                this._currentListId = localStorage.getItem("currentListId") ?? "";
                setAtom(playListAtom, this._playList);
                if (this._playList.length !== playList.length) {
                    localStorage.setItem("playList", JSON.stringify(this._playList));
                }
            }

            const progress = getStoredProgress();
            const music =
                progress?.music && progress.music.platform
                    ? progress.music
                    : getStoredCurrentMusic();
            if (music?.platform && music?.id) {
                let position = 0;
                if (
                    isRememberProgressEnabled() &&
                    progress &&
                    playListKey(progress.music) === playListKey(music)
                ) {
                    const raw = Number(progress.position);
                    const duration = Number(progress.duration) || 0;
                    if (
                        Number.isFinite(raw) &&
                        raw >= MIN_REMEMBER_POSITION &&
                        !(duration > 0 && raw > duration - END_GAP)
                    ) {
                        position = raw;
                    }
                }
                this._currentMusic = music;
                setAtom(currentMusicAtom, music);
                if (position > 0) {
                    setAtom(progressAtom, {
                        position,
                        duration: progress?.duration || music.duration || 0,
                    });
                    this.pendingStartPosition = position;
                }
            }

            const savedRepeat = localStorage.getItem("repeatMode");
            if (savedRepeat) {
                this._repeatMode = savedRepeat as MusicRepeatMode;
                setAtom(repeatModeAtom, this._repeatMode);
            }
        } catch (e) {
            console.warn("[trackPlayer] 恢复上次播放失败", e);
        }
    }

    /** 当前歌曲 + 听到哪儿（切后台 / 关页面前落盘用） */
    private collectProgress(): IPlayProgressRecord | null {
        const music = this._currentMusic;
        if (!music?.platform || !music?.id) {
            return null;
        }
        const audio = this.audio;
        const hasSource = !!audio?.src;
        const progress = store.get(progressAtom);
        const audioDuration =
            hasSource && Number.isFinite(audio?.duration ?? NaN)
                ? (audio!.duration as number)
                : 0;
        return {
            music: slimMusic(music),
            position: round1(hasSource ? audio!.currentTime || 0 : progress.position || 0),
            duration: round1(audioDuration || progress.duration || music.duration || 0),
            updatedAt: Date.now(),
        };
    }

    private persistProgress() {
        try {
            if (!isRememberProgressEnabled()) {
                return;
            }
            const record = this.collectProgress();
            if (record) {
                localStorage.setItem(PROGRESS_KEY, JSON.stringify(record));
            }
        } catch {
            // ignore
        }
    }

    /** ---------- 内部事件 ---------- */
    private onProgress = () => {
        if (!this.audio) {
            return;
        }
        this.clearStallWatch();
        const progress = {
            position: this.audio.currentTime || 0,
            duration: this.audio.duration || 0,
        };
        setAtom(progressAtom, progress);
        this.emit(TrackPlayerEvents.ProgressChanged, progress);
    };

    private clearStallWatch = () => {
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
    };

    /** 播放停滞自救：12 秒还没恢复就微调进度，强制浏览器重新取流 */
    private onAudioStall = () => {
        if (this.stallTimer) {
            return;
        }
        this.stallTimer = setTimeout(() => {
            this.stallTimer = null;
            const audio = this.audio;
            if (!audio || audio.paused || audio.ended) {
                return;
            }
            if (this.stallNudges >= 3) {
                return;
            }
            this.stallNudges += 1;
            try {
                audio.currentTime = (audio.currentTime || 0) + 0.05;
            } catch {
                // ignore
            }
        }, 12000);
    };

    private onAudioPause = () => {
        this.clearStallWatch();
        if (this.isLoading) {
            return;
        }
        if (this._currentMusic) {
            setAtom(musicStateAtom, "paused");
        }
    };

    private onAudioPlay = () => {
        setAtom(musicStateAtom, "playing");
    };

    private onAudioPlaying = () => {
        this.clearStallWatch();
        this.isLoading = false;
        this.autoSkipCount = 0;
        this.qualityRetryCount = 0;
        setAtom(musicStateAtom, "playing");
    };

    private onAudioError = async () => {
        const err = this.audio?.error;
        console.warn(`[trackPlayer] media error code=${err?.code} message=${err?.message}`);
        if (!this._currentMusic || !this.audio?.src) {
            return;
        }
        await this.handlePlayFailure(this._currentMusic, describeMediaError(err));
    };

    /** 断掉当前音源并静音 */
    private detachAudio() {
        this.clearStallWatch();
        this.clearPendingSeek();
        const audio = this.audio;
        if (!audio) {
            return;
        }
        audio.pause();
        audio.removeAttribute("src");
        try {
            audio.load();
        } catch {
            // ignore
        }
    }

    private clearPendingSeek() {
        if (this.pendingSeekListener) {
            this.audio?.removeEventListener("loadedmetadata", this.pendingSeekListener);
            this.pendingSeekListener = null;
        }
    }

    /** 把播放位置摆到目标处（HAVE_NOTHING 时赋值会成为「默认起播位置」） */
    private applyStartPosition(audio: HTMLAudioElement, position: number) {
        if (!(position > 0) || !Number.isFinite(position)) {
            return;
        }
        this.clearPendingSeek();
        const seek = () => {
            try {
                audio.currentTime = position;
            } catch {
                // ignore
            }
        };
        seek();
        if (audio.readyState >= 1) {
            return;
        }
        const listener = () => {
            this.pendingSeekListener = null;
            if (Math.abs((audio.currentTime || 0) - position) > 2) {
                seek();
            }
        };
        this.pendingSeekListener = listener;
        audio.addEventListener("loadedmetadata", listener, { once: true });
    }

    /** 进入"解析音源中"：立刻静音旧歌，状态置为 loading */
    private beginLoading() {
        this.isLoading = true;
        this.detachAudio();
        setAtom(playingQualityAtom, null);
        if (this._currentMusic) {
            setAtom(musicStateAtom, "loading");
        }
    }

    /** 取消在途的加载（用户按暂停，或被一次新的换歌请求取代） */
    private cancelLoading() {
        this.pendingPlayId = "";
        this.isLoading = false;
        this.detachAudio();
        setAtom(musicStateAtom, this._currentMusic ? "paused" : "stopped");
    }

    /** 还能往下降的下一档音质 */
    private lowerQualityForRetry(musicItem: IMusic.IMusicItem): IMusic.IQualityKey | null {
        if (musicItem.localPath) {
            return null;
        }
        const used = this.resolvedQuality;
        if (!used) {
            return null;
        }
        const idx = QUALITY_LADDER.indexOf(used);
        return idx > 0 ? QUALITY_LADDER[idx - 1] : null;
    }

    /** 播放失败：先在本曲内按音质降级自救，救不了再自动往后跳一首 */
    private async handlePlayFailure(
        musicItem: IMusic.IMusicItem,
        rawReason: string,
        options?: { allowQualityRetry?: boolean },
    ) {
        const reason = rawReason || "未知原因";
        this.isLoading = false;
        const retryPosition = this.audio?.currentTime || 0;
        this.detachAudio();

        const lowerQuality =
            options?.allowQualityRetry === false ? null : this.lowerQualityForRetry(musicItem);
        if (lowerQuality && this.qualityRetryCount < MAX_QUALITY_RETRY) {
            this.qualityRetryCount += 1;
            console.warn(
                `[trackPlayer] 播放失败：${musicItem.title}（${reason}），降级为 ${lowerQuality} 重试`,
            );
            this.pendingStartPosition = retryPosition;
            this.emit(TrackPlayerEvents.PlayFailed, {
                musicItem,
                reason,
                willSkip: false,
                downgradedTo: lowerQuality,
            } as IPlayFailurePayload);
            this.qualityRetrying = true;
            try {
                await this.play(musicItem, true, this.isInPlayList(musicItem), lowerQuality);
            } finally {
                this.qualityRetrying = false;
            }
            return;
        }

        const willSkip = this.autoSkipCount < MAX_AUTO_SKIP && this._playList.length > 1;
        this.emit(TrackPlayerEvents.PlayFailed, { musicItem, reason, willSkip } as IPlayFailurePayload);

        if (!willSkip) {
            setAtom(musicStateAtom, this._currentMusic ? "paused" : "stopped");
            return;
        }
        this.autoSkipCount += 1;
        this.autoSkipping = true;
        try {
            await this.skipToNext();
        } finally {
            this.autoSkipping = false;
        }
    }

    private onEnded = async () => {
        if (!this._currentMusic) {
            return;
        }
        if (this.pendingNextIndex() >= 0) {
            await this.skipToNext();
            return;
        }
        if (this._repeatMode === "single") {
            const audio = this.audio;
            if (!audio) {
                return;
            }
            if (!audio.src) {
                await this.play(this._currentMusic, true);
                return;
            }
            audio.currentTime = 0;
            audio.play().catch((e) =>
                console.warn("[trackPlayer] repeat-single failed", e?.name ?? e),
            );
            return;
        }
        if (this._playList.length === 0) {
            this.emit(TrackPlayerEvents.PlayEnd);
            setAtom(musicStateAtom, "stopped");
            return;
        }
        const index = this.getMusicIndexInPlayList(this._currentMusic);
        if (
            index === this._playList.length - 1 &&
            this._repeatMode === "off" &&
            this._playList.length > 1
        ) {
            this.emit(TrackPlayerEvents.PlayEnd);
            setAtom(musicStateAtom, "stopped");
            return;
        }
        await this.skipToNext();
    };

    /** ---------- 播放列表管理 ---------- */
    get playList() {
        return this._playList;
    }
    get currentMusic() {
        return this._currentMusic;
    }
    get repeatMode() {
        return this._repeatMode;
    }

    private persistPlayList() {
        const slim = (item: IMusic.IMusicItem): IMusic.IMusicItem =>
            typeof item.artwork === "string" && item.artwork.length > MAX_PERSISTED_ARTWORK
                ? { ...item, artwork: "" }
                : item;
        try {
            localStorage.setItem(
                "playList",
                JSON.stringify(this._playList.slice(0, 500).map(slim)),
            );
            if (this._currentListId) {
                localStorage.setItem("currentListId", this._currentListId);
            } else {
                localStorage.removeItem("currentListId");
            }
            if (this._currentMusic) {
                localStorage.setItem("currentMusic", JSON.stringify(slim(this._currentMusic)));
            } else {
                localStorage.removeItem("currentMusic");
            }
        } catch {
            // localStorage 写满等异常不影响播放
        }
    }

    getMusicIndexInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return -1;
        }
        return this._playList.findIndex(
            (it) => it.id === musicItem.id && it.platform === musicItem.platform,
        );
    }

    isInPlayList(musicItem?: IMusic.IMusicItem | null) {
        return this.getMusicIndexInPlayList(musicItem) >= 0;
    }

    isPlayListEmpty() {
        return this._playList.length === 0;
    }

    private notifyPlayListAdded() {
        setAtom(playListAddedAtom, store.get(playListAddedAtom) + 1);
    }

    /** 追加到播放队列。已经在队列里的歌不会再塞一份（按 platform+id 认）。 */
    addAll(
        musicItems: IMusic.IMusicItem[],
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): number {
        const inQueue = new Set(this._playList.map(playListKey));
        const valid = toQueueableList(musicItems).filter((it) => !inQueue.has(playListKey(it)));
        const list = [...this._playList];
        const insertAt = beforeIndex === undefined ? list.length : beforeIndex;
        if (shouldShuffle) {
            valid.sort(() => Math.random() - 0.5);
        }
        list.splice(insertAt, 0, ...valid);
        this._playList = list;
        setAtom(playListAtom, this._playList);
        if (valid.length) {
            this.notifyPlayListAdded();
        }
        this.persistPlayList();
        return valid.length;
    }

    add(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[], beforeIndex?: number) {
        const items = Array.isArray(musicItem) ? musicItem : [musicItem];
        return this.addAll(items, beforeIndex);
    }

    /** 插到当前这首之后，并登记为待播（随机/单曲循环下也能保证播出） */
    addNext(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) {
        const items = Array.isArray(musicItem) ? musicItem : [musicItem];
        const keys = new Set(items.filter(isQueueable).map(playListKey));
        if (keys.size) {
            this._playList = this._playList.filter((it) => !keys.has(playListKey(it)));
        }
        const currentIndex = this.getMusicIndexInPlayList(this._currentMusic);
        const added = this.addAll(items, currentIndex + 1);
        this.declarePendingNext(items);
        return added;
    }

    private declarePendingNext(musicItems: IMusic.IMusicItem[]) {
        for (const musicItem of musicItems) {
            const key = playListKey(musicItem);
            if (
                !isQueueable(musicItem) ||
                this.isCurrentMusic(musicItem) ||
                this._pendingNext.includes(key)
            ) {
                continue;
            }
            this._pendingNext.push(key);
        }
    }

    private consumePendingNext(musicItem: IMusic.IMusicItem) {
        const key = playListKey(musicItem);
        const at = this._pendingNext.indexOf(key);
        if (at >= 0) {
            this._pendingNext.splice(at, 1);
        }
    }

    private pendingNextIndex() {
        for (const key of this._pendingNext) {
            const index = this._playList.findIndex((it) => playListKey(it) === key);
            if (index >= 0) {
                return index;
            }
        }
        return -1;
    }

    async remove(musicItem: IMusic.IMusicItem) {
        const index = this.getMusicIndexInPlayList(musicItem);
        if (index < 0) {
            return;
        }
        const removingCurrent = this.isCurrentMusic(musicItem);
        const list = [...this._playList];
        list.splice(index, 1);
        this._playList = list;
        setAtom(playListAtom, this._playList);
        this.persistPlayList();
        this.consumePendingNext(musicItem);
        if (removingCurrent) {
            if (list.length === 0) {
                await this.clearPlayListAndStop();
            } else {
                await this.play(list[Math.min(index, list.length - 1)], true);
            }
        }
    }

    isCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem || !this._currentMusic) {
            return false;
        }
        return (
            musicItem.id === this._currentMusic.id &&
            musicItem.platform === this._currentMusic.platform
        );
    }

    /** 清空播放队列，正在播的这首继续播 */
    clearPlayList() {
        this._playList = [];
        setAtom(playListAtom, []);
        this._pendingNext = [];
        this.persistPlayList();
    }

    /** 清空队列并且彻底停下 */
    async clearPlayListAndStop() {
        this._currentMusic = null;
        this.pendingPlayId = "";
        this.isLoading = false;
        this.autoSkipCount = 0;
        setAtom(currentMusicAtom, null);
        setAtom(musicStateAtom, "stopped");
        setAtom(progressAtom, { position: 0, duration: 0 });
        setAtom(playingQualityAtom, null);
        this.detachAudio();
        this.clearPlayList();
        this._history = [];
        try {
            localStorage.removeItem("playProgress");
        } catch {
            // ignore
        }
    }

    /** ---------- 播放控制 ---------- */

    /** 解析可播放音源。音质按 resolveQualityLadder 从请求档逐级下降尝试。 */
    private async resolveMediaUrl(
        musicItem: IMusic.IMusicItem,
        qualityOverride?: IMusic.IQualityKey,
        excludeUrl?: string,
    ): Promise<{
        src: string;
        source?: IPlugin.IMediaSourceResult;
        quality: IMusic.IQualityKey | null;
    } | null> {
        const plugin = await getPluginByMedia(musicItem);
        if (plugin?.supportedMethods.includes("getMediaSource")) {
            const requested =
                qualityOverride ??
                pickSupportedQuality(getQuality(), musicItem.qualities) ??
                getQuality();
            for (const quality of resolveQualityLadder(requested)) {
                try {
                    const source = (await Promise.race([
                        pluginCall(
                            plugin.hash,
                            "getMediaSource",
                            musicItem,
                            quality,
                        ) as Promise<IPlugin.IMediaSourceResult | null>,
                        new Promise<never>((_, reject) =>
                            setTimeout(
                                () => reject(new Error("音源响应超时")),
                                MEDIA_SOURCE_TIMEOUT,
                            ),
                        ),
                    ])) as IPlugin.IMediaSourceResult | null;
                    if (source?.url) {
                        if (source.url === excludeUrl) {
                            console.warn(`[trackPlayer] ${quality} 返回的直链与刚失败的相同，跳过`);
                            continue;
                        }
                        return {
                            src: buildPlayableMediaUrl({
                                url: source.url,
                                headers: source.headers,
                                userAgent: source.userAgent,
                            }),
                            source,
                            quality,
                        };
                    }
                } catch (e: any) {
                    console.warn(`[trackPlayer] getMediaSource failed (${quality}):`, e?.message ?? e);
                }
            }
        }
        if (musicItem.url) {
            if (musicItem.url === excludeUrl) {
                return null;
            }
            return {
                src: buildPlayableMediaUrl({ url: musicItem.url }),
                source: { url: musicItem.url },
                quality: null,
            };
        }
        return null;
    }

    private async updateMediaSession(musicItem: IMusic.IMusicItem) {
        if ("mediaSession" in navigator) {
            let artwork: string | undefined = musicItem.artwork;
            if (artwork && artwork.length > MAX_PERSISTED_ARTWORK) {
                artwork = undefined;
            }
            navigator.mediaSession.metadata = new MediaMetadata({
                title: musicItem.title,
                artist: musicItem.artist,
                album: musicItem.album,
                artwork: artwork ? [{ src: artwork, sizes: "512x512" }] : [],
            });
            navigator.mediaSession.setActionHandler("play", () => this.resume());
            navigator.mediaSession.setActionHandler("pause", () => this.pause());
            navigator.mediaSession.setActionHandler("previoustrack", () => this.skipToPrevious());
            navigator.mediaSession.setActionHandler("nexttrack", () => this.skipToNext());
        }
    }

    async play(
        musicItem?: IMusic.IMusicItem | null,
        forcePlay?: boolean,
        addToPlayList = true,
        qualityOverride?: IMusic.IQualityKey,
    ) {
        if (!musicItem && !this._currentMusic) {
            return;
        }
        const target = musicItem ?? this._currentMusic!;
        const playId = `${target.platform}-${target.id}-${Date.now()}-${++this.playSeq}`;
        this.pendingPlayId = playId;

        const isNew = !this.isCurrentMusic(target);
        const willLoad = isNew || !!forcePlay;
        const resumePosition = this.isCurrentMusic(target) ? this.pendingStartPosition : 0;

        if (!this.autoSkipping && !this.qualityRetrying) {
            this.autoSkipCount = 0;
            this.qualityRetryCount = 0;
        }

        if (isNew) {
            this.stallNudges = 0;
            this.pendingStartPosition = 0;
            if (addToPlayList && !this.isInPlayList(target)) {
                this.add(target);
            }
            this._currentMusic = target;
            this.consumePendingNext(target);
            this.pushHistory(target);
            setAtom(currentMusicAtom, target);
            this.emit(TrackPlayerEvents.CurrentMusicChanged, target);
            setMusicHistory(target);
            this.persistPlayList();
            setAtom(progressAtom, { position: resumePosition, duration: target.duration ?? 0 });
        }

        if (willLoad) {
            // 解析音源可能耗时很久，这一步就把上一首停掉
            this.beginLoading();
        }

        try {
            const resolved = await this.resolveMediaUrl(
                target,
                qualityOverride,
                qualityOverride ? (this.resolvedSourceUrl ?? undefined) : undefined,
            );
            if (this.pendingPlayId !== playId) {
                return;
            }
            if (!resolved) {
                await this.handlePlayFailure(target, "音源没有返回可播放的链接", {
                    allowQualityRetry: false,
                });
                return;
            }
            this.resolvedQuality = resolved.quality;
            this.resolvedSourceUrl = resolved.source?.url ?? null;
            setAtom(playingQualityAtom, resolved.quality);
            const audio = this.audio;
            if (!audio) {
                return;
            }
            audio.src = resolved.src;
            audio.playbackRate = this._rate;
            this.applyStartPosition(audio, resumePosition);
            this.pendingStartPosition = 0;
            await this.updateMediaSession(target);
            if (this.pendingPlayId !== playId) {
                return;
            }
            this.isLoading = false;
            await audio.play();
            if (this.pendingPlayId === playId) {
                setAtom(musicStateAtom, "playing");
            }
        } catch (e: any) {
            if (this.pendingPlayId !== playId) {
                return;
            }
            await this.handlePlayFailure(target, describePlayError(e));
        }
    }

    private resume() {
        const audio = this.audio;
        if (!audio) {
            return;
        }
        if (!audio.src) {
            if (this._currentMusic) {
                this.play(this._currentMusic, true);
            }
            return;
        }
        audio.play().catch((e) => {
            console.warn("[trackPlayer] resume failed", e?.name ?? e);
        });
    }

    async pause() {
        if (this.isLoading) {
            this.cancelLoading();
            return;
        }
        this.audio?.pause();
        setAtom(musicStateAtom, "paused");
    }

    async togglePlay() {
        if (this.isLoading) {
            this.cancelLoading();
            return;
        }
        if (!this._currentMusic) {
            if (this._playList.length) {
                await this.play(this._playList[0]);
            }
            return;
        }
        if (this.audio && !this.audio.src) {
            await this.play(this._currentMusic, true);
            return;
        }
        if (this.audio?.paused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    private async getNextIndex(direction: 1 | -1): Promise<number> {
        const len = this._playList.length;
        if (!len) {
            return -1;
        }
        const curIndex = this.getMusicIndexInPlayList(this._currentMusic);
        if (this._repeatMode === "queue") {
            if (len === 1) {
                return curIndex;
            }
            let next = curIndex;
            while (next === curIndex) {
                next = Math.floor(Math.random() * len);
            }
            return next;
        }
        if (curIndex < 0) {
            return 0;
        }
        return (curIndex + direction + len) % len;
    }

    async skipToNext() {
        const pendingIndex = this.pendingNextIndex();
        if (pendingIndex >= 0) {
            await this.play(this._playList[pendingIndex], true);
            return;
        }
        const nextIndex = await this.getNextIndex(1);
        if (nextIndex >= 0) {
            await this.play(this._playList[nextIndex], true);
        }
    }

    private pushHistory(musicItem: IMusic.IMusicItem) {
        const last = this._history[this._history.length - 1];
        if (last && last.id === musicItem.id && last.platform === musicItem.platform) {
            return;
        }
        this._history.push(musicItem);
        if (this._history.length > MAX_HISTORY) {
            this._history = this._history.slice(-MAX_HISTORY);
        }
    }

    private takePreviousFromHistory() {
        const prev = this._history[this._history.length - 2];
        if (!prev) {
            return null;
        }
        if (this.isCurrentMusic(this._history[this._history.length - 1])) {
            this._history.pop();
        }
        return prev;
    }

    async skipToPrevious() {
        const prev = this.takePreviousFromHistory();
        if (prev) {
            await this.play(prev, true, this.isInPlayList(prev));
            return;
        }
        if (!this.isInPlayList(this._currentMusic)) {
            return;
        }
        const nextIndex = await this.getNextIndex(-1);
        if (nextIndex >= 0) {
            await this.play(this._playList[nextIndex], true);
        }
    }

    /** 「播放全部」从哪一首开始：随机模式下随机挑一首，否则第一首 */
    pickPlayAllStart(list: IMusic.IMusicItem[]) {
        if (this._repeatMode !== "queue" || list.length < 2) {
            return list[0];
        }
        return list[Math.floor(Math.random() * list.length)];
    }

    /** 整队替换并从这首开始播 */
    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
        listId = "",
        forceReplace = false,
    ) {
        const alreadyThisList =
            !forceReplace &&
            !!listId &&
            this._currentListId === listId &&
            this.isInPlayList(musicItem);
        if (!alreadyThisList) {
            this._playList = toQueueableList(newPlayList);
            this._currentListId = listId;
            this._pendingNext = [];
            setAtom(playListAtom, this._playList);
            this.notifyPlayListAdded();
            this.persistPlayList();
        }
        await this.play(musicItem, true);
    }

    toggleRepeatMode() {
        const order: MusicRepeatMode[] = ["off", "queue", "single"];
        const next = order[(order.indexOf(this._repeatMode) + 1) % order.length];
        this._repeatMode = next;
        setAtom(repeatModeAtom, next);
        localStorage.setItem("repeatMode", next);
    }

    async seekTo(position: number) {
        if (this.audio && Number.isFinite(this.audio.duration)) {
            this.audio.currentTime = position;
            setAtom(progressAtom, { position, duration: this.audio.duration || 0 });
            return;
        }
        if (this._currentMusic) {
            this.pendingStartPosition = position;
            setAtom(progressAtom, { position, duration: this._currentMusic.duration || 0 });
        }
    }

    async setRate(rate: number) {
        this._rate = rate;
        if (this.audio) {
            this.audio.playbackRate = rate;
        }
        setAtom(rateAtom, rate);
    }

    setVolume(volume: number) {
        const next = Math.min(Math.max(volume, 0), 1);
        if (this.audio) {
            this.audio.volume = next;
        }
        localStorage.setItem("volume", String(next));
        setAtom(volumeAtom, next);
    }

    getVolume() {
        return this.audio?.volume ?? getStoredVolume();
    }

    /** 切换音质：正在播就记住位置重新解析，暂停中只作废音源（下次播放用新音质） */
    async applyQuality(quality: IMusic.IQualityKey) {
        setQuality(quality);
        setAtom(qualityAtom, quality);
        const music = this._currentMusic;
        const audio = this.audio;
        if (!music || music.localPath || !audio?.src) {
            return;
        }
        this.pendingStartPosition = audio.currentTime || 0;
        if (audio.paused) {
            this.detachAudio();
            return;
        }
        await this.play(music, true);
    }

    getProgress() {
        if (this.audio) {
            return {
                position: this.audio.currentTime,
                duration: this.audio.duration || 0,
            };
        }
        return { position: 0, duration: 0 };
    }
}

export const TrackPlayerSingleton = new TrackPlayer();

/** ---------- hooks ---------- */
export function usePlayList() {
    return useAtomValue(playListAtom);
}
export function useCurrentMusic() {
    return useAtomValue(currentMusicAtom);
}
export function useMusicState() {
    return useAtomValue(musicStateAtom);
}
export function useRepeatMode() {
    return useAtomValue(repeatModeAtom);
}
export function useVolume() {
    return useAtomValue(volumeAtom);
}
export function useQuality() {
    return useAtomValue(qualityAtom);
}
export function usePlayingQuality() {
    return useAtomValue(playingQualityAtom);
}
export function setDefaultQuality(quality: IMusic.IQualityKey) {
    setQuality(quality);
    setAtom(qualityAtom, quality);
}
/** 播放栏即时切换音质：重解析当前歌曲（设置页改默认值用 setDefaultQuality） */
export function applyQuality(quality: IMusic.IQualityKey) {
    return TrackPlayerSingleton.applyQuality(quality);
}
export function useProgress() {
    return useAtomValue(progressAtom);
}
export function useCurrentLyric() {
    return useAtomValue(currentLyricAtom);
}

export const currentLyricAtom = atom<ILyric.IParsedLrc>([]);

/** 加载当前歌曲歌词（插件接口名与桌面端一致：getLyric） */
export async function loadCurrentLyric(musicItem: IMusic.IMusicItem) {
    let lyricSource: ILyric.ILyricSource | null = musicItem.lyric ?? null;
    if (!lyricSource && !musicItem.localPath) {
        const plugin = await getPluginByMedia(musicItem);
        if (plugin?.supportedMethods.includes("getLyric")) {
            try {
                lyricSource = await pluginCall(plugin.hash, "getLyric", musicItem);
            } catch {
                // ignore
            }
        }
    }
    let rawLrc = lyricSource?.rawLrc ?? "";
    if (!rawLrc && lyricSource?.lrc) {
        try {
            rawLrc = await (await fetch(lyricSource.lrc)).text();
        } catch {
            // ignore
        }
    }
    store.set(currentLyricAtom, rawLrc ? parseLrc(rawLrc) : []);
}

function parseLrc(rawLrc: string): ILyric.IParsedLrc {
    const result: ILyric.IParsedLrc = [];
    const lines = rawLrc.split("\n");
    const timeReg = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
    lines.forEach((line) => {
        const text = line.replace(timeReg, "").trim();
        let match: RegExpExecArray | null;
        timeReg.lastIndex = 0;
        while ((match = timeReg.exec(line)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const fraction = match[3]
                ? parseInt(match[3], 10) / Math.pow(10, match[3].length)
                : 0;
            const time = minutes * 60 + seconds + fraction;
            result.push({ time, lrc: text, index: result.length });
        }
    });
    result.sort((a, b) => a.time - b.time);
    return result;
}
