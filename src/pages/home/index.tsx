import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { homeTabAtom } from "@/core/uiAtoms";
import { getPlugins, type SerializedPlugin } from "@/core/ipc";
import { pickSourcePlugins, useGlobalSource } from "@/core/mediaSource";
import { tryPluginMethod } from "@/core/pluginUtils";
import SheetCardGrid, { SheetCard } from "@/components/base/SheetCardGrid";
import { IconChevronDown, IconChevronUp } from "@/components/base/Icons";
import { navigate } from "@/core/router";

/**
 * 发现页：顶部标签在 TopBar（推荐/歌单/排行榜）。
 *  - 推荐：置顶标签 + 推荐歌单网格（分页加载）
 *  - 歌单：全部标签选择 + 歌单网格
 *  - 排行榜：getTopLists 分组网格
 */

/**
 * 插件返回的标签不可信：酷我会往 pinned/分组 data 里混入 null 项，
 * 且 pinned 与分组常有同 id 重复（桌面端同款问题，见其 uniqueById 注释）。
 * 这里过滤掉无法展示的无效项并按 id 去重（无 id 的条目保留）。
 */
function sanitizeSheetTags(data: any): any[] {
    const seen = new Set<string>();
    const tags: any[] = [];
    for (const tag of [
        ...(data?.pinned ?? []),
        ...(data?.data ?? []).flatMap((g: any) => g?.data ?? []),
    ]) {
        if (!tag || typeof tag !== "object" || !tag.title) {
            continue;
        }
        const id = tag.id == null ? "" : String(tag.id);
        if (id) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
        }
        tags.push(tag);
    }
    return tags;
}

export default function HomePage() {
    const tab = useAtomValue(homeTabAtom);
    return (
        <div className="home-page">
            {tab === "toplist" ? <TopListTab /> : <SheetsTab tab={tab} />}
        </div>
    );
}

/** 推荐歌单 / 歌单 两个标签共用（差别是标签选择区的展示） */
function SheetsTab({ tab }: { tab: "recommend" | "sheets" }) {
    const [plugins, setPlugins] = useState<SerializedPlugin[] | null>(null);
    const sourceHash = useGlobalSource();
    const [allTags, setAllTags] = useState<any[]>([]);
    const [activeTag, setActiveTag] = useState<any>(null);
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItemBase[]>([]);
    const [page, setPage] = useState(1);
    const [isEnd, setIsEnd] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
    const fetchingMoreRef = useRef(false);
    const fetchSeqRef = useRef(0);

    // 标签区默认只展示一行，超出折叠：chip 宽度随标题文字变化，断行只能靠真实布局测量。
    // 隐藏测量层始终渲染全量标签，量出每行位置；展开按钮宽度也从测量层读取。
    const tagBoxRef = useRef<HTMLDivElement | null>(null);
    const measureRef = useRef<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [collapsedCount, setCollapsedCount] = useState<number | null>(null);
    const [hasOverflow, setHasOverflow] = useState(false);

    const measureTagRows = useCallback(() => {
        const box = tagBoxRef.current;
        const meter = measureRef.current;
        if (!box || !meter) {
            return;
        }
        const chips = Array.from(
            meter.querySelectorAll<HTMLButtonElement>(".tag-chip:not(.tag-chip-toggle)"),
        );
        const toggleEl = meter.querySelector<HTMLButtonElement>(".tag-chip-toggle");
        if (!chips.length || !toggleEl) {
            return;
        }
        const row1 = chips.filter((c) => c.offsetTop === chips[0].offsetTop);
        const toggleW = toggleEl.offsetWidth;
        const boxW = box.clientWidth;
        const fitsInOneRow = row1.length >= chips.length;
        if (expanded) {
            setHasOverflow(!fitsInOneRow);
            return;
        }
        if (fitsInOneRow) {
            setCollapsedCount(null);
            setHasOverflow(false);
            return;
        }
        // 收起时标签只占一行，且行末要留一格给展开按钮：
        // 保留 k 个标签后按钮落在 row1[k] 现在的位置，取仍能容纳按钮的最大 k
        let k = 1;
        while (k < row1.length && row1[k].offsetLeft + toggleW <= boxW) {
            k += 1;
        }
        setCollapsedCount(Math.max(1, k - 1));
        setHasOverflow(true);
    }, [expanded]);

    const chipsVisible = tab === "sheets" && allTags.length > 0;

    useLayoutEffect(() => {
        if (!chipsVisible) {
            return;
        }
        measureTagRows();
    }, [chipsVisible, allTags, measureTagRows]);

    // 容器宽度变化（窗口/侧栏/横竖屏）时重算折叠
    useEffect(() => {
        const box = tagBoxRef.current;
        if (!chipsVisible || !box || typeof ResizeObserver === "undefined") {
            return;
        }
        const ro = new ResizeObserver(() => measureTagRows());
        ro.observe(box);
        return () => ro.disconnect();
    }, [chipsVisible, measureTagRows]);

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    // 音源变化时重拉标签（标签决定第一页歌单）
    useEffect(() => {
        if (!plugins) {
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            setSheets([]);
            const candidates = pickSourcePlugins(plugins, "getRecommendSheetTags", sourceHash);
            const res = await tryPluginMethod<any>(candidates, "getRecommendSheetTags");
            if (cancelled) {
                return;
            }
            if (res?.data) {
                const tags = sanitizeSheetTags(res.data);
                setAllTags(tags);
                setActiveTag(tags[0] ?? null);
                if (!tags.length) {
                    setIsEnd(true);
                    setLoading(false);
                }
            } else {
                setAllTags([]);
                setActiveTag(null);
                setIsEnd(true);
                setLoading(false);
                setError(
                    candidates.length
                        ? "音源加载失败，换个音源试试"
                        : "没有音源支持推荐歌单",
                );
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [plugins, sourceHash]);

    const fetchSheets = useCallback(
        async (tag: any, pageNum: number, replace: boolean) => {
            // 加载更多串行化：哨兵连续触发不会重复请求同一页
            if (!replace && fetchingMoreRef.current) {
                return;
            }
            const seq = ++fetchSeqRef.current;
            replace ? setLoading(true) : setLoadingMore(true);
            setError(null);
            setLoadError(false);
            if (!replace) {
                fetchingMoreRef.current = true;
            }
            const candidates = pickSourcePlugins(plugins ?? [], "getRecommendSheetsByTag", sourceHash);
            const res = await tryPluginMethod<any>(candidates, "getRecommendSheetsByTag", [tag, pageNum]);
            if (seq !== fetchSeqRef.current) {
                // 已有更新的请求（如切换标签）接管了列表，丢弃过期结果
                return;
            }
            if (res?.data?.data) {
                const fresh = res.data.data as IMusic.IMusicSheetItemBase[];
                setSheets((prev) => {
                    if (replace) {
                        return fresh;
                    }
                    const seen = new Set(prev.map((it) => `${it.platform}-${it.id}`));
                    return [...prev, ...fresh.filter((it) => !seen.has(`${it.platform}-${it.id}`))];
                });
                setIsEnd(!!res.data.isEnd || !fresh.length);
                setPage(pageNum);
            } else if (replace) {
                setSheets([]);
                setIsEnd(true);
                if (!candidates.length) {
                    setError("没有音源支持推荐歌单");
                }
            } else {
                // 翻页失败不锁死成“没有更多了”，留出重试入口
                setLoadError(true);
                setIsEnd(!candidates.length);
            }
            setLoading(false);
            setLoadingMore(false);
            fetchingMoreRef.current = false;
        },
        [plugins, sourceHash],
    );

    useEffect(() => {
        if (activeTag) {
            fetchSheets(activeTag, 1, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTag]);

    const loadMore = useCallback(() => {
        if (!activeTag || isEnd || loading || !sheets.length) {
            return;
        }
        fetchSheets(activeTag, page + 1, false);
    }, [activeTag, isEnd, loading, sheets.length, page, fetchSheets]);

    // 滚动到底自动加载：哨兵进入视口下方 600px 时拉取下一页；
    // 数据变化后重建观察，若哨兵仍在视口内会立刻再触发，连续加载直到铺满
    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;
    useEffect(() => {
        const el = loadMoreSentinelRef.current;
        if (!el) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    loadMoreRef.current?.();
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [isEnd, sheets.length, activeTag]);

    if (plugins && !plugins.length) {
        return (
            <div className="page-inner">
                <div className="page-empty">
                    <div>还没有安装音源插件</div>
                    <button className="btn primary" onClick={() => navigate("pluginManage")}>
                        去安装音源插件
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-inner">
            {chipsVisible && (
                <div className="page-toolbar">
                    <div className="tag-chips" ref={tagBoxRef}>
                        {(expanded || collapsedCount == null
                            ? allTags
                            : allTags.slice(0, collapsedCount)
                        ).map((tag, idx) => (
                            <button
                                key={`${tag.id ?? tag.title}-${idx}`}
                                className={`tag-chip ${activeTag?.id === tag.id ? "active" : ""}`}
                                onClick={() => setActiveTag(tag)}
                            >
                                {tag.title}
                            </button>
                        ))}
                        {hasOverflow && (
                            <button
                                className="tag-chip tag-chip-toggle"
                                onClick={() => setExpanded(!expanded)}
                            >
                                {expanded ? "收起" : "展开"}
                                {expanded ? (
                                    <IconChevronUp size={13} />
                                ) : (
                                    <IconChevronDown size={13} />
                                )}
                            </button>
                        )}
                        <div
                            className="tag-chips tag-chips-measure"
                            aria-hidden="true"
                            ref={measureRef}
                        >
                            {allTags.map((tag, idx) => (
                                <button
                                    key={`${tag.id ?? tag.title}-${idx}`}
                                    className="tag-chip"
                                    tabIndex={-1}
                                >
                                    {tag.title}
                                </button>
                            ))}
                            <button className="tag-chip tag-chip-toggle" tabIndex={-1}>
                                展开
                                <IconChevronDown size={13} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : error && !sheets.length ? (
                <div className="page-empty">
                    <div>{error}</div>
                    <button className="btn primary" onClick={() => navigate("pluginManage")}>
                        管理音源插件
                    </button>
                </div>
            ) : (
                <>
                    <SheetCardGrid
                        sheets={sheets}
                        getSubtitle={(it) =>
                            (it as any).creator ?? (it as any).username ?? undefined
                        }
                    />
                    {!isEnd && sheets.length > 0 && (
                        <div ref={loadMoreSentinelRef} className="load-more-sentinel" />
                    )}
                    {loadingMore && (
                        <div className="list-loading-more">
                            <span className="spinner" />
                            <span>加载中…</span>
                        </div>
                    )}
                    {loadError && !isEnd && sheets.length > 0 && (
                        <div className="load-more">
                            <button
                                className="btn ghost"
                                onClick={() => fetchSheets(activeTag, page + 1, false)}
                            >
                                加载失败，点击重试
                            </button>
                        </div>
                    )}
                    {isEnd && sheets.length > 0 && <div className="list-end-hint">没有更多了</div>}
                </>
            )}
        </div>
    );
}

/** 排行榜标签：getTopLists 分组 */
function TopListTab() {
    const [plugins, setPlugins] = useState<SerializedPlugin[] | null>(null);
    const sourceHash = useGlobalSource();
    const [groups, setGroups] = useState<IMusic.IMusicSheetGroupItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getPlugins().then(setPlugins);
    }, []);

    useEffect(() => {
        if (!plugins) {
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            const candidates = pickSourcePlugins(plugins, "getTopLists", sourceHash);
            const res = await tryPluginMethod<IMusic.IMusicSheetGroupItem[]>(
                candidates,
                "getTopLists",
            );
            if (!cancelled) {
                if (res?.data) {
                    setGroups(res.data ?? []);
                } else {
                    setGroups([]);
                    setError(candidates.length ? "音源加载失败，换个音源试试" : "没有音源支持排行榜");
                }
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plugins, sourceHash]);

    if (plugins && !plugins.length) {
        return (
            <div className="page-inner">
                <div className="page-empty">
                    <div>还没有安装音源插件</div>
                    <button className="btn primary" onClick={() => navigate("pluginManage")}>
                        去安装音源插件
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-inner">
            {loading ? (
                <div className="page-loading">
                    <span className="spinner big" />
                </div>
            ) : error && !groups.length ? (
                <div className="page-empty">
                    <div>{error}</div>
                    <button className="btn primary" onClick={() => navigate("pluginManage")}>
                        管理音源插件
                    </button>
                </div>
            ) : (
                groups.map((group, gi) => (
                    <section key={`${group.title}-${gi}`} className="toplist-section">
                        <h3 className="section-title">{group.title}</h3>
                        <div className="sheet-grid">
                            {(group.data ?? []).map((item, idx) => (
                                <SheetCard
                                    key={`${item.platform}-${item.id}-${idx}`}
                                    sheetItem={item}
                                    onClick={() => navigate("topListDetail", { topListItem: item })}
                                />
                            ))}
                        </div>
                    </section>
                ))
            )}
        </div>
    );
}
