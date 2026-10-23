// 介面文字（導覽、按鈕）集中在這裡；作品內容不在此。
// 目前全站用 zh；之後做英文版時，頁面改傳 "en" 就能切換，不用逐頁找字。
export const ui = {
	zh: {
		"nav.about": "關於我",
		"nav.contact": "合作／委託",
		"grid.viewGroup": "瀏覽方式",
		"grid.viewType": "字",
		"grid.viewTypeLabel": "單色字",
		"grid.viewImage": "圖",
		"grid.viewImageLabel": "圖片",
		"grid.latest": "最新",
		"grid.random": "隨機",
		"grid.search": "搜尋",
		"grid.clearSearch": "清除搜尋",
		"grid.more": "更多",
		"project.back": "返回",
		"project.prev": "上一篇",
		"project.next": "下一篇",
		"project.home": "首頁",
		"project.random": "隨機",
	},
	en: {
		"nav.about": "About",
		"nav.contact": "Commissions",
		"grid.viewGroup": "View",
		"grid.viewType": "Type",
		"grid.viewTypeLabel": "Wordmarks",
		"grid.viewImage": "Image",
		"grid.viewImageLabel": "Images",
		"grid.latest": "Latest",
		"grid.random": "Random",
		"grid.search": "Search",
		"grid.clearSearch": "Clear search",
		"grid.more": "More",
		"project.back": "Back",
		"project.prev": "Prev",
		"project.next": "Next",
		"project.home": "Home",
		"project.random": "Random",
	},
} as const;

export type Lang = keyof typeof ui;
export type UiKey = keyof (typeof ui)["zh"];

export const defaultLang: Lang = "zh";

export const useTranslations = (lang: Lang = defaultLang) => (key: UiKey) => ui[lang][key] ?? ui[defaultLang][key];
