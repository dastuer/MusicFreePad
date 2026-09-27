import { useEffect, useState } from "react";
import { getMusicHistory, clearMusicHistory, type HistoryItem } from "@/core/musicHistory";
import { showToast } from "@/core/uiAtoms";
import MusicList from "@/components/base/MusicList";

/** 最近播放 */
export default function HistoryPage() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    useEffect(() => {
        setHistory(getMusicHistory());
    }, []);

    return (
        <div className="page-inner">
            <div className="page-toolbar">
                <button
                    className="btn ghost small"
                    onClick={() => {
                        clearMusicHistory();
                        setHistory([]);
                        showToast("播放历史已清空");
                    }}
                    disabled={!history.length}
                >
                    清空历史
                </button>
            </div>
            {history.length ? (
                <MusicList musicList={history} listId="history" />
            ) : (
                <div className="page-empty">还没有播放记录</div>
            )}
        </div>
    );
}
