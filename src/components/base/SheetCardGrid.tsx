import { navigate } from "@/core/router";
import Cover from "./Cover";
import { formatPlayCount } from "@/core/utils";
import { IconHeadphone } from "./Icons";

/**
 * 歌单/排行榜网格卡片（网易云 Pad 风格）：
 * 方形封面、圆角、右上角播放数徽标、下方两行标题 + 一行副标题。
 */

export function SheetCard({
    sheetItem,
    onClick,
    subtitle,
}: {
    sheetItem: IMusic.IMusicSheetItemBase;
    onClick?: () => void;
    subtitle?: string;
}) {
    return (
        <div className="sheet-card" onClick={onClick}>
            <div className="sheet-card-cover">
                <Cover src={sheetItem.artwork} radius={10} className="sheet-card-img" />
                {!!sheetItem.playCount && (
                    <div className="sheet-card-count">
                        <IconHeadphone size={12} strokeWidth={2.4} />
                        <span>{formatPlayCount(sheetItem.playCount)}</span>
                    </div>
                )}
            </div>
            <div className="sheet-card-title">{sheetItem.title}</div>
            {(subtitle || sheetItem.description) && (
                <div className="sheet-card-sub">{subtitle ?? sheetItem.description}</div>
            )}
        </div>
    );
}

export default function SheetCardGrid({
    sheets,
    getSubtitle,
}: {
    sheets: IMusic.IMusicSheetItemBase[];
    getSubtitle?: (item: IMusic.IMusicSheetItemBase) => string | undefined;
}) {
    return (
        <div className="sheet-grid">
            {sheets.map((item, idx) => (
                <SheetCard
                    key={`${item.platform}-${item.id}-${idx}`}
                    sheetItem={item}
                    subtitle={getSubtitle?.(item)}
                    onClick={() => navigate("sheetDetail", { sheetItem: item })}
                />
            ))}
        </div>
    );
}
