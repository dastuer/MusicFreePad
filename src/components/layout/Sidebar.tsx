import { useCurrentRoute, navigate, RoutePath } from "@/core/router";
import { nowPlayingOpenAtom, queueOpenAtom } from "@/core/uiAtoms";
import { useAtomValue } from "jotai";
import {
    IconDiscover,
    IconSearch,
    IconMusic,
    IconHistory,
    IconPuzzle,
    IconSettings,
} from "@/components/base/Icons";

/** 左侧导航栏（网易云 Pad 风格：图标 + 小字标签竖排） */

const NAV_ITEMS: {
    path: RoutePath;
    label: string;
    icon: (props: { size?: number }) => JSX.Element;
    /** 详情页归属的父级高亮 */
    aliases?: RoutePath[];
}[] = [
    { path: "home", label: "发现", icon: IconDiscover, aliases: ["topList", "topListDetail", "albumDetail", "artistDetail"] },
    { path: "search", label: "搜索", icon: IconSearch },
    { path: "myMusic", label: "我的", icon: IconMusic, aliases: ["sheetDetail"] },
    { path: "history", label: "最近", icon: IconHistory },
    { path: "pluginManage", label: "插件", icon: IconPuzzle },
    { path: "settings", label: "设置", icon: IconSettings },
];

export default function Sidebar() {
    const route = useCurrentRoute();
    const nowPlayingOpen = useAtomValue(nowPlayingOpenAtom);
    const queueOpen = useAtomValue(queueOpenAtom);
    void nowPlayingOpen;
    void queueOpen;

    return (
        <nav className="sidebar">
            <div className="sidebar-items">
                {NAV_ITEMS.map((item) => {
                    const active =
                        route.path === item.path || item.aliases?.includes(route.path);
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.path}
                            className={`sidebar-item ${active ? "active" : ""}`}
                            onClick={() => navigate(item.path)}
                        >
                            <Icon size={21} />
                            <span className="sidebar-item-label">{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
