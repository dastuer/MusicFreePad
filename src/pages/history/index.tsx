import { useEffect, useState } from "react";
import { getMusicHistory, clearMusicHistory, type HistoryItem } from "@/core/musicHistory";
import { showToast } from "@/core/uiAtoms";
import MusicList from "@/components/base/MusicList";
import ListSearchBar from "@/components/base/ListSearchBar";
import PlayAllBar from "@/components/base/PlayAllBar";
import SelectActionsBar from "@/components/base/SelectActionsBar";
import { IconSearch } from "@/components/base/Icons";
import { useListSearch } from "@/hooks/useListSearch";
import { useMusicMultiSelect } from "@/hooks/useMusicMultiSelect";

/** 最近播放 */
export default function HistoryPage() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    useEffect(() => {
        setHistory(getMusicHistory());
    }, []);

    // 局部搜索 + 多选（批量收藏到歌单）
    const search = useListSearch(history);
    const viewList = search.active ? search.filtered : history;
    const multi = useMusicMultiSelect(history, viewList);

    return (
        <div className="page-inner">
            <div className="page-toolbar">
                {multi.selectMode ? (
                    <PlayAllBar
                        count={viewList.length}
                        onPlayAll={() => {}}
                        selectMode
                        selectedCount={multi.selected.length}
                        onExitSelect={multi.exitSelect}
                        onSelectAll={multi.selectAll}
                        onDeselectAll={multi.deselectAll}
                    />
                ) : (
                    <>
                        <button
                            className="btn ghost small"
                            onClick={() => search.setOpen(!search.open)}
                            disabled={!history.length}
                        >
                            <IconSearch size={14} />
                            <span>搜索</span>
                        </button>
                        <button
                            className="btn ghost small"
                            onClick={multi.enterSelect}
                            disabled={!history.length}
                        >
                            多选
                        </button>
                        <button
                            className="btn ghost small"
                            onClick={() => {
                                clearMusicHistory();
                                setHistory([]);
                                search.close();
                                multi.exitSelect();
                                showToast("播放历史已清空");
                            }}
                            disabled={!history.length}
                        >
                            清空历史
                        </button>
                    </>
                )}
            </div>
            {search.open && <ListSearchBar search={search} />}
            {viewList.length ? (
                <>
                    <MusicList
                        musicList={viewList}
                        listId="history"
                        selectMode={multi.selectMode}
                        selectedKeys={multi.selectedKeys}
                        onToggleSelect={multi.toggleSelect}
                    />
                    {multi.selectMode && (
                        <SelectActionsBar
                            count={multi.selected.length}
                            onDownload={multi.startDownload}
                            downloading={multi.downloading}
                            onCollect={multi.startCollect}
                        />
                    )}
                </>
            ) : (
                <div className="page-empty">
                    {search.active ? "没有匹配的播放记录" : "还没有播放记录"}
                </div>
            )}
        </div>
    );
}
