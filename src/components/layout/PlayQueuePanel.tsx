import { useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { TrackPlayerSingleton, useCurrentMusic, usePlayList } from "@/core/trackPlayer";
import { queueOpenAtom, showToast } from "@/core/uiAtoms";
import { useBackLayer } from "@/core/systemBack";
import Cover from "@/components/base/Cover";
import { IconClose, IconTrash, IconPlaying, IconMenu } from "@/components/base/Icons";

/** 播放队列抽屉（右侧）：行内拖拽把手可调整播放顺序（清单 12） */

interface IDragState {
    from: number;
    target: number;
    /** 拖拽行跟手的位移（含列表自动滚动补偿） */
    dy: number;
    rowH: number;
}

/** 拖拽中不进 React 状态的原始量（高频 move 里读写） */
interface IDragRaw {
    from: number;
    startY: number;
    startScrollTop: number;
    lastClientY: number;
    rowH: number;
}

export default function PlayQueuePanel() {
    const open = useAtomValue(queueOpenAtom);
    const setOpen = useSetAtom(queueOpenAtom);
    const playList = usePlayList();
    const currentMusic = useCurrentMusic();
    const [drag, setDrag] = useState<IDragState | null>(null);
    const dragRawRef = useRef<IDragRaw | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    // 系统返回先收起抽屉
    useBackLayer(open, "play-queue", () => setOpen(false));

    if (!open) {
        return null;
    }

    /** 由指针位置算落点行号：内容坐标 / 行高，向上插到目标行前、向下插到目标行后恰好同值 */
    const calcTarget = (raw: IDragRaw) => {
        const listEl = listRef.current;
        const len = playList.length;
        if (!listEl || !len) {
            return raw.from;
        }
        const rect = listEl.getBoundingClientRect();
        const contentY = raw.lastClientY - rect.top + listEl.scrollTop;
        return Math.min(Math.max(Math.floor(contentY / raw.rowH), 0), len - 1);
    };

    const syncDragVisual = (raw: IDragRaw) => {
        const listEl = listRef.current;
        const scrollDelta = listEl ? listEl.scrollTop - raw.startScrollTop : 0;
        setDrag({
            from: raw.from,
            target: calcTarget(raw),
            dy: raw.lastClientY - raw.startY + scrollDelta,
            rowH: raw.rowH,
        });
    };

    const onDragStart = (e: React.PointerEvent, index: number) => {
        const row = (e.currentTarget as HTMLElement).closest(".queue-row") as HTMLElement | null;
        if (!row) {
            return;
        }
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const raw: IDragRaw = {
            from: index,
            startY: e.clientY,
            startScrollTop: listRef.current?.scrollTop ?? 0,
            lastClientY: e.clientY,
            rowH: row.getBoundingClientRect().height,
        };
        dragRawRef.current = raw;
        syncDragVisual(raw);
    };

    const onDragMove = (e: React.PointerEvent) => {
        const raw = dragRawRef.current;
        if (!raw) {
            return;
        }
        raw.lastClientY = e.clientY;
        // 拖到列表上下边缘时顺手滚动（跟手滚动，无 rAF 循环，长队列中途停留不滚）
        const listEl = listRef.current;
        if (listEl) {
            const rect = listEl.getBoundingClientRect();
            if (e.clientY < rect.top + 48) {
                listEl.scrollTop -= 10;
            } else if (e.clientY > rect.bottom - 48) {
                listEl.scrollTop += 10;
            }
        }
        syncDragVisual(raw);
    };

    const onDragEnd = () => {
        const raw = dragRawRef.current;
        dragRawRef.current = null;
        if (raw && drag && drag.target !== drag.from) {
            TrackPlayerSingleton.reorderMusic(raw.from, drag.target);
        }
        setDrag(null);
    };

    /** 渲染行内位移：拖拽行跟手，途经的行整体让位滑开 */
    const rowShiftStyle = (idx: number): React.CSSProperties | undefined => {
        if (!drag) {
            return undefined;
        }
        if (idx === drag.from) {
            return {
                transform: `translateY(${drag.dy}px)`,
                zIndex: 2,
                position: "relative",
                background: "var(--hover-bg)",
                boxShadow: "0 2px 14px rgba(0, 0, 0, 0.18)",
            };
        }
        if (idx > drag.from && idx <= drag.target) {
            return { transform: `translateY(${-drag.rowH}px)` };
        }
        if (idx < drag.from && idx >= drag.target) {
            return { transform: `translateY(${drag.rowH}px)` };
        }
        return undefined;
    };

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
                <div className="queue-list" ref={listRef}>
                    {playList.map((item, idx) => {
                        const isCurrent =
                            currentMusic?.id === item.id &&
                            currentMusic?.platform === item.platform;
                        const shift = rowShiftStyle(idx);
                        return (
                            <div
                                key={`${item.platform}-${item.id}-${idx}`}
                                className={`queue-row ${isCurrent ? "current" : ""} ${
                                    shift && idx !== drag?.from ? "drag-shift" : ""
                                }`}
                                style={shift}
                                onClick={() => {
                                    if (!drag) {
                                        TrackPlayerSingleton.play(item, true);
                                    }
                                }}
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
                                    className="queue-drag-handle"
                                    title="拖动排序"
                                    onPointerDown={(e) => onDragStart(e, idx)}
                                    onPointerMove={onDragMove}
                                    onPointerUp={onDragEnd}
                                    onPointerCancel={onDragEnd}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <IconMenu size={14} />
                                </button>
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
