import rss from "@astrojs/rss";
import { getCollection, getEntry } from "astro:content";

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

	const items = [];
	for (const project of sorted) {
		const slug = getProjectSlug(project.id);
		const entry = await getEntry("projects", project.id);
		let bodyHtml = entry?.rendered?.html ?? "";
		bodyHtml = bodyHtml.replace(
			/<a href="(https?:\/\/[^"]+)"([^>]*)>/g,
			'<a href="$1" target="_blank" rel="noopener noreferrer"$2>',
		);

		items.push({
			title: project.data.title,
			description: project.data.description ?? undefined,
			content: bodyHtml || undefined,
			pubDate: project.data.pubDate ?? new Date(0),
			link: `/projects/${slug}`,
			categories: project.data.tags,
		});
	}

	return rss({
		title: "howmay_ Lettering & Logotype",
		description: "作品集 RSS — 字體、字型與標誌設計",
		site: context.site,
		items,
		customData: "<language>zh-tw</language>",
		trailingSlash: false,
	});
}
