import { useCallback, useMemo, useState } from "react";
import { openMusicActions, openAddToSheet, showToast } from "@/core/uiAtoms";

/**
 * 列表页多选逻辑（歌单 / 历史等列表共用）：
 *  - 选中集合驱动 MusicList 勾选圈；
 *  - 收藏：批量加入歌单面板；
 *  - 删除（用户歌单）：从歌单中删除。
 *
 * 与手机版的差异：下载相关的批量能力（startDownload / downloading）
 * 依赖下载体系（Pad 第三批），届时再补进本 hook 与 SelectActionsBar。
 */
/**
 * @param musicList 完整列表：校验选中项仍在列表内
 * @param scopeList 「全选」的范围，默认全列表；列表页局部搜索时传过滤结果
 */
export function useMusicMultiSelect(
    musicList: IMusic.IMusicItem[],
    scopeList: IMusic.IMusicItem[] = musicList,
) {
    const [selectMode, setSelectMode] = useState(false);
    const [pickedItems, setPickedItems] = useState<IMusic.IMusicItem[]>([]);

    /** 实际生效的选中：过滤掉已不在当前列表里的歌（如刚被移出歌单） */
    const selected = useMemo(
        () =>
            pickedItems.filter((it) =>
                musicList.some((m) => m.platform === it.platform && m.id === it.id),
            ),
        [pickedItems, musicList],
    );

    const selectedKeys = useMemo(
        () => new Set(selected.map((it) => `${it.platform}-${it.id}`)),
        [selected],
    );

    const enterSelect = useCallback(() => {
        setPickedItems([]);
        setSelectMode(true);
    }, []);

    const exitSelect = useCallback(() => {
        setSelectMode(false);
        setPickedItems([]);
    }, []);

    const toggleSelect = useCallback((item: IMusic.IMusicItem) => {
        setPickedItems((prev) => {
            const idx = prev.findIndex((it) => it.platform === item.platform && it.id === item.id);
            if (idx >= 0) {
                return prev.filter((_, i) => i !== idx);
            }
            return [...prev, item];
        });
    }, []);

    const selectAll = useCallback(() => {
        setPickedItems([...scopeList]);
    }, [scopeList]);

    const deselectAll = useCallback(() => {
        setPickedItems([]);
    }, []);

    /** 批量收藏到歌单 */
    const startCollect = useCallback(() => {
        if (!selected.length) {
            return;
        }
        openAddToSheet(selected);
    }, [selected]);

    /**
     * 批量删除（用户歌单）：从歌单中删除。
     * @param onRemoveFromSheet 执行「从歌单中删除」的回调（页面负责落盘 + 刷新自身状态）
     */
    const startDelete = useCallback(
        (onRemoveFromSheet: (items: IMusic.IMusicItem[]) => void) => {
            if (!selected.length) {
                return;
            }
            openMusicActions({
                musicItem: { id: "__batch__", platform: "__batch__" } as any,
                title: "删除歌曲",
                subtitle: `已选 ${selected.length} 首歌曲`,
                actions: [
                    {
                        label: "从歌单中删除",
                        danger: true,
                        onClick: () => {
                            onRemoveFromSheet(selected);
                            showToast(`已从歌单中删除 ${selected.length} 首歌曲`);
                            exitSelect();
                        },
                    },
                ],
            });
        },
        [selected, exitSelect],
    );

    return {
        selectMode,
        selected,
        selectedKeys,
        enterSelect,
        exitSelect,
        toggleSelect,
        selectAll,
        deselectAll,
        startCollect,
        startDelete,
    };
}
