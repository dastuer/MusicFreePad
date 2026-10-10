import { IconDownload, IconHeart, IconTrash } from "./Icons";

/**
 * 多选模式底部操作栏：下载 / 收藏 / 喜欢 / 删除（按需传入，未传的不渲染）。
 * sticky 吸底，未选中任何歌曲时按钮置灰。
 * 下载依赖下载体系（Pad 第三批），接线前页面不传 onDownload 即可。
 */
export default function SelectActionsBar({
    count,
    onDownload,
    onCollect,
    onLike,
    onDelete,
    downloading = false,
}: {
    count: number;
    onDownload?: () => void;
    onCollect: () => void;
    onLike?: () => void;
    onDelete?: () => void;
    downloading?: boolean;
}) {
    const disabled = count === 0;
    return (
        <div className="select-actions-bar">
            {onDownload && (
                <button
                    className="select-action"
                    disabled={disabled || downloading}
                    onClick={onDownload}
                >
                    <IconDownload size={21} />
                    <span>{downloading ? "下载中…" : "下载"}</span>
                </button>
            )}
            <button className="select-action" disabled={disabled} onClick={onCollect}>
                <IconHeart size={21} />
                <span>收藏</span>
            </button>
            {onLike && (
                <button className="select-action" disabled={disabled} onClick={onLike}>
                    <IconHeart size={21} filled />
                    <span>喜欢</span>
                </button>
            )}
            {onDelete && (
                <button className="select-action" disabled={disabled} onClick={onDelete}>
                    <IconTrash size={21} />
                    <span>删除</span>
                </button>
            )}
        </div>
    );
}
