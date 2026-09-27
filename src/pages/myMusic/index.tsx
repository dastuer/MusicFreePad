import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import {
    getUserSheets,
    ensureLikesSheet,
    createSheet,
    deleteSheet,
    renameSheet,
    sheetsVersionAtom,
    LIKES_SHEET_ID,
    LIKES_SHEET_TITLE,
    type IUserSheet,
} from "@/core/musicSheet";
import { getMusicHistory, type HistoryItem } from "@/core/musicHistory";
import { navigate } from "@/core/router";
import { openPrompt, openMusicActions, showToast } from "@/core/uiAtoms";
import { TrackPlayerSingleton } from "@/core/trackPlayer";
import MusicList from "@/components/base/MusicList";
import Cover from "@/components/base/Cover";
import { IconPlay, IconPlus, IconMore } from "@/components/base/Icons";

/** 我的音乐：喜欢的音乐 + 自建歌单（卡片墙）+ 最近在听 */
export default function MyMusicPage() {
    const sheetsVersion = useAtomValue(sheetsVersionAtom);
    const [sheets, setSheets] = useState<IUserSheet[]>([]);
    const [recent, setRecent] = useState<HistoryItem[]>([]);

    useEffect(() => {
        ensureLikesSheet();
        setSheets(getUserSheets());
    }, [sheetsVersion]);

    useEffect(() => {
        setRecent(getMusicHistory().slice(0, 12));
    }, []);

    const likes = sheets.find((it) => it.id === LIKES_SHEET_ID);
    const userSheets = sheets.filter((it) => it.id !== LIKES_SHEET_ID);

    return (
        <div className="page-inner my-music">
            {/* 我喜欢的音乐 大卡片 */}
            {likes && (
                <div
                    className="likes-card"
                    onClick={() => navigate("sheetDetail", { userSheetId: likes.id })}
                >
                    <div className="likes-card-cover">
                        {likes.musicList.slice(0, 4).map((it, idx) => (
                            <Cover key={idx} src={it.artwork} size={54} radius={8} />
                        ))}
                        {!likes.musicList.length && (
                            <div className="likes-card-empty">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                    <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.9 6.7 4.9c2.2 0 3.9 1.3 5.3 3.2 1.4-1.9 3.1-3.2 5.3-3.2 3.3 0 5.3 3.1 4 6.4-1.8 4.6-9.3 9.2-9.3 9.2z" />
                                </svg>
                            </div>
                        )}
                    </div>
                    <div className="likes-card-info">
                        <div className="likes-card-title">{LIKES_SHEET_TITLE}</div>
                        <div className="likes-card-sub">{likes.musicList.length} 首</div>
                        <button
                            className="btn primary likes-card-play"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (likes.musicList.length) {
                                    TrackPlayerSingleton.playWithReplacePlayList(
                                        TrackPlayerSingleton.pickPlayAllStart(likes.musicList),
                                        likes.musicList,
                                        `usersheet:${LIKES_SHEET_ID}`,
                                        true,
                                    );
                                } else {
                                    showToast("先去收藏几首喜欢的歌吧");
                                }
                            }}
                        >
                            <IconPlay size={15} />
                            <span>播放全部</span>
                        </button>
                    </div>
                </div>
            )}

            {/* 自建歌单 */}
            <div className="section-head">
                <h3 className="section-title">自建歌单</h3>
                <button
                    className="btn ghost small"
                    onClick={() =>
                        openPrompt({
                            title: "新建歌单",
                            placeholder: "歌单标题",
                            confirmText: "创建",
                            onConfirm: (title) => {
                                if (title) {
                                    createSheet(title);
                                    showToast("歌单已创建");
                                }
                            },
                        })
                    }
                >
                    <IconPlus size={15} />
                    <span>新建</span>
                </button>
            </div>
            {userSheets.length ? (
                <div className="user-sheet-grid">
                    {userSheets.map((sheet) => (
                        <div
                            key={sheet.id}
                            className="user-sheet-card"
                            onClick={() => navigate("sheetDetail", { userSheetId: sheet.id })}
                        >
                            <Cover
                                src={sheet.musicList[0]?.artwork}
                                className="user-sheet-cover"
                                radius={10}
                            />
                            <div className="user-sheet-info">
                                <div className="user-sheet-title">{sheet.title}</div>
                                <div className="user-sheet-sub">{sheet.musicList.length} 首</div>
                            </div>
                            <button
                                className="icon-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openMusicActions({
                                        musicItem: { id: sheet.id, platform: "local", title: sheet.title, artist: "" } as any,
                                        actions: [
                                            {
                                                label: "重命名",
                                                onClick: () =>
                                                    openPrompt({
                                                        title: "重命名歌单",
                                                        defaultValue: sheet.title,
                                                        confirmText: "保存",
                                                        onConfirm: (title) => {
                                                            if (title) {
                                                                renameSheet(sheet.id, title);
                                                            }
                                                        },
                                                    }),
                                            },
                                            {
                                                label: "删除歌单",
                                                danger: true,
                                                onClick: () => {
                                                    deleteSheet(sheet.id);
                                                    showToast("歌单已删除");
                                                },
                                            },
                                        ],
                                    });
                                }}
                            >
                                <IconMore size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="page-empty small">还没有自建歌单，点右上角「新建」创建一个</div>
            )}

            {/* 最近在听 */}
            {recent.length > 0 && (
                <>
                    <div className="section-head">
                        <h3 className="section-title">最近在听</h3>
                        <button className="text-btn" onClick={() => navigate("history")}>
                            全部
                        </button>
                    </div>
                    <MusicList
                        musicList={recent}
                        listId="history-recent"
                        showIndex={false}
                    />
                </>
            )}
        </div>
    );
}
