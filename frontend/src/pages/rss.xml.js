import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

function getProjectSlug(id) {
	return id.replace(/\/index$/, "") || id;
}

export async function GET(context) {
	const projects = await getCollection("projects");
	const sorted = [...projects].sort((a, b) => {
		const da = a.data.pubDate?.getTime() ?? 0;
		const db = b.data.pubDate?.getTime() ?? 0;
		return db - da;
	});

	return rss({
		title: "howmay_ Lettering & Logotype",
		description: "作品集 RSS — 字體、字型與標誌設計",
		site: context.site,
		items: sorted.map((project) => {
			const slug = getProjectSlug(project.id);
			return {
				title: project.data.title,
				description: project.data.description ?? undefined,
				pubDate: project.data.pubDate ?? new Date(0),
				link: `/projects/${slug}`,
				categories: project.data.tags,
			};
		}),
		customData: "<language>zh-tw</language>",
		trailingSlash: false,
	});
}
