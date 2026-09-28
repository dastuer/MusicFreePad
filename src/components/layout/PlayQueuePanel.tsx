import { useAtomValue, useSetAtom } from "jotai";
import { TrackPlayerSingleton, useCurrentMusic, usePlayList } from "@/core/trackPlayer";
import { queueOpenAtom, showToast } from "@/core/uiAtoms";
import { useBackLayer } from "@/core/systemBack";
import Cover from "@/components/base/Cover";
import { IconClose, IconTrash, IconPlaying } from "@/components/base/Icons";

/** 播放队列抽屉（右侧） */
export default function PlayQueuePanel() {
    const open = useAtomValue(queueOpenAtom);
    const setOpen = useSetAtom(queueOpenAtom);
    const playList = usePlayList();
    const currentMusic = useCurrentMusic();

    // 系统返回先收起抽屉
    useBackLayer(open, "play-queue", () => setOpen(false));

    if (!open) {
        return null;
    }

    return (
        <div className="queue-mask" onClick={() => setOpen(false)}>
            <div className="queue-panel" onClick={(e) => e.stopPropagation()}>
                <div className="queue-header">
                    <div className="queue-title">
                        当前播放<span className="queue-count">{playList.length}</span>
                    </div>
                    <div className="queue-header-actions">
                        <button
                            className="icon-btn"
                            title="清空列表"
                            onClick={async () => {
                                await TrackPlayerSingleton.clearPlayListAndStop();
                                showToast("播放队列已清空");
                            }}
                        >
                            <IconTrash size={18} />
                        </button>
                        <button className="icon-btn" onClick={() => setOpen(false)}>
                            <IconClose size={20} />
                        </button>
                    </div>
                </div>
                <div className="queue-list">
                    {playList.map((item, idx) => {
                        const isCurrent =
                            currentMusic?.id === item.id &&
                            currentMusic?.platform === item.platform;
                        return (
                            <div
                                key={`${item.platform}-${item.id}-${idx}`}
                                className={`queue-row ${isCurrent ? "current" : ""}`}
                                onClick={() => TrackPlayerSingleton.play(item, true)}
                            >
                                <div className="queue-row-lead">
                                    {isCurrent ? <IconPlaying size={14} /> : <span>{idx + 1}</span>}
                                </div>
                                <Cover src={item.artwork} size={36} radius={4} />
                                <div className="queue-row-info">
                                    <div className="queue-row-title">{item.title}</div>
                                    <div className="queue-row-artist">{item.artist}</div>
                                </div>
                                <button
                                    className="icon-btn queue-row-remove"
                                    title="移除"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        TrackPlayerSingleton.remove(item);
                                    }}
                                >
                                    <IconClose size={14} />
                                </button>
                            </div>
                        );
                    })}
                    {!playList.length && (
                        <div className="queue-empty">队列空空如也</div>
                    )}
                </div>
            </div>
        </div>
    );
}
