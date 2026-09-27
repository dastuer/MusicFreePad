import { useCallback, useRef, useState } from "react";

/**
 * 垂直滑条（自下而上），用于音量悬浮弹层等。
 * 交互与水平 Slider 一致：拖动中 onInput 实时回调，松手 onCommit。
 */
export default function VSlider({
    value,
    max,
    onCommit,
    onInput,
    height = 120,
    className = "",
}: {
    value: number;
    max: number;
    onCommit: (value: number) => void;
    onInput?: (value: number) => void;
    height?: number;
    className?: string;
}) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [dragValue, setDragValue] = useState<number | null>(null);

    const posToValue = useCallback(
        (clientY: number) => {
            const el = trackRef.current;
            if (!el) {
                return 0;
            }
            const rect = el.getBoundingClientRect();
            const ratio = 1 - (clientY - rect.top) / rect.height;
            return Math.min(1, Math.max(0, ratio)) * max;
        },
        [max],
    );

    const onPointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        const v0 = posToValue(e.clientY);
        setDragValue(v0);
        onInput?.(v0);
        const onMove = (ev: PointerEvent) => {
            const v = posToValue(ev.clientY);
            setDragValue(v);
            onInput?.(v);
        };
        const onUp = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            onCommit(posToValue(ev.clientY));
            setDragValue(null);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const shown = dragValue ?? value;
    const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

    return (
        <div className={`vslider ${className}`} style={{ height }} onPointerDown={onPointerDown}>
            <div className="vslider-track" ref={trackRef}>
                <div className="vslider-fill" style={{ height: `${pct}%` }} />
                <div className="vslider-thumb" style={{ bottom: `${pct}%` }} />
            </div>
        </div>
    );
}
