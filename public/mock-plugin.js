/**
 * 本地测试音源插件（仅用于开发联调）
 * 与 MusicFree 移动端/桌面端插件格式一致，可用插件管理页的 URL 安装：
 *   http://localhost:5174/mock-plugin.js
 */
module.exports = {
    platform: "测试音源",
    version: "0.1.0",
    author: "MusicFreePad",
    description: "本地开发测试用音源（假数据）",
    srcUrl: "http://localhost:5174/mock-plugin.js",
    userVariables: [{ key: "token", name: "访问令牌（随便填）" }],

    async search(query, page, type) {
        const base = (page - 1) * 20;
        if (type === "music") {
            return {
                isEnd: page >= 3,
                data: Array.from({ length: 20 }, (_, i) => makeMusic(base + i, query)),
            };
        }
        if (type === "sheet") {
            return {
                isEnd: page >= 2,
                data: Array.from({ length: 12 }, (_, i) => makeSheet(`sheet-s-${base + i}`, `${query} 相关歌单 ${base + i + 1}`)),
            };
        }
        if (type === "album") {
            return {
                isEnd: true,
                data: Array.from({ length: 10 }, (_, i) => makeAlbum(base + i, `${query} 专辑 ${base + i + 1}`)),
            };
        }
        return {
            isEnd: true,
            data: Array.from({ length: 8 }, (_, i) => makeArtist(base + i, `${query}歌手${String.fromCharCode(65 + (i % 26))}`)),
        };
    },

    async getMediaSource(musicItem, quality) {
        return {
            url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            quality,
        };
    },

    async getLyric(musicItem) {
        const lines = [
            "[00:00.00]测试音源 · 歌词演示",
            "[00:04.00]这是第一句歌词，用来验证滚动",
            "[00:08.00]这是第二句歌词，点击可以跳转进度",
            "[00:12.00]第三句：歌词来自插件的 getLyric",
            "[00:16.00]第四句： Pad 版播放器正在播放",
            "[00:20.00]第五句：歌词会随进度自动滚动",
            "[00:24.00]第六句：横屏左右分栏 竖屏上下堆叠",
            "[00:28.00]第七句：完",
        ];
        return { rawLrc: lines.join("\n") };
    },

    async getRecommendSheetTags() {
        return {
            pinned: [{ id: "hot", title: "热门" }, { id: "new", title: "最新" }],
            data: [
                {
                    title: "风格",
                    data: [
                        { id: "pop", title: "流行" },
                        { id: "rock", title: "摇滚" },
                        { id: "folk", title: "民谣" },
                        { id: "electronic", title: "电子" },
                        { id: "jazz", title: "爵士" },
                        { id: "classical", title: "古典" },
                    ],
                },
                {
                    title: "场景",
                    data: [
                        { id: "study", title: "学习" },
                        { id: "run", title: "运动" },
                        { id: "sleep", title: "睡眠" },
                        { id: "drive", title: "驾车" },
                    ],
                },
            ],
        };
    },

    async getRecommendSheetsByTag(tag, page) {
        const base = (page - 1) * 24;
        return {
            isEnd: page >= 3,
            data: Array.from({ length: 24 }, (_, i) =>
                makeSheet(`sheet-${tag.id}-${base + i}`, `${tag.title}歌单 ${base + i + 1}`),
            ),
        };
    },

    async getTopLists() {
        return [
            {
                title: "官方榜",
                data: [
                    makeSheet("top-1", "飙升榜", "每个工作日更新"),
                    makeSheet("top-2", "新歌榜", "每天更新"),
                    makeSheet("top-3", "热歌榜", "每周四更新"),
                    makeSheet("top-4", "原创榜", "每周五更新"),
                ],
            },
            {
                title: "特色榜",
                data: [
                    makeSheet("top-5", "云音乐说唱榜", "每周四更新"),
                    makeSheet("top-6", "ACG 新歌榜", "每周三更新"),
                    makeSheet("top-7", "电子音乐榜", "每周五更新"),
                ],
            },
        ];
    },

    async getTopListDetail(topListItem, page) {
        const base = (page - 1) * 30;
        return {
            isEnd: page >= 2,
            musicList: Array.from({ length: 30 }, (_, i) =>
                makeMusic(base + i, `${topListItem.title} 第${base + i + 1}名`),
            ),
        };
    },

    async getMusicSheetInfo(sheetItem, page) {
        const base = (page - 1) * 25;
        return {
            sheetItem: { ...sheetItem, worksNum: 50 },
            isEnd: page >= 2,
            musicList: Array.from({ length: 25 }, (_, i) => makeMusic(base + i)),
        };
    },

    async getAlbumInfo(albumItem, page) {
        const base = (page - 1) * 12;
        return {
            albumItem: { ...albumItem, worksNum: 12 },
            isEnd: true,
            musicList: Array.from({ length: 12 }, (_, i) => makeMusic(base + i, `${albumItem.title} 曲目 ${i + 1}`)),
        };
    },

    async getArtistWorks(artistItem, page, type) {
        const base = (page - 1) * 15;
        if (type === "album") {
            return {
                isEnd: true,
                data: Array.from({ length: 6 }, (_, i) => makeAlbum(base + i, `${artistItem.name} 专辑 ${i + 1}`)),
            };
        }
        return {
            isEnd: true,
            data: Array.from({ length: 15 }, (_, i) => makeMusic(base + i, `${artistItem.name} 单曲 ${base + i + 1}`)),
        };
    },
};

function makeMusic(i, title) {
    const idx = (i % 12) + 1;
    return {
        id: `m-${i}`,
        platform: "测试音源",
        title: title ?? `示例歌曲 ${idx}号`,
        artist: `歌手${String.fromCharCode(65 + (i % 8))}`,
        album: `专辑《${1 + (i % 5)}》`,
        duration: 180 + (i % 5) * 30,
        artwork: `https://picsum.photos/seed/mfp-music-${i % 40}/300/300`,
        albumId: `al-${i % 5}`,
        qualities: { standard: {}, high: {} },
    };
}

function makeSheet(id, title, description) {
    return {
        id,
        platform: "测试音源",
        title,
        artwork: `https://picsum.photos/seed/mfp-sheet-${id}/400/400`,
        description: description ?? `${title} · 测试数据`,
        playCount: Math.floor(Math.random() * 90000000) + 100000,
        creator: "测试创建者",
    };
}

function makeAlbum(i, title) {
    return {
        id: `al-${i}`,
        platform: "测试音源",
        title,
        artwork: `https://picsum.photos/seed/mfp-album-${i}/400/400`,
        artist: `歌手${String.fromCharCode(65 + (i % 8))}`,
        date: `202${i % 5}`,
        artistId: `ar-${i % 8}`,
    };
}

function makeArtist(i, name) {
    return {
        id: `ar-${i}`,
        platform: "测试音源",
        name,
        avatar: `https://picsum.photos/seed/mfp-artist-${i}/300/300`,
        worksNum: 20 + i,
    };
}
