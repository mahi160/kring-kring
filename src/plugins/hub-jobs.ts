import { definePlugin } from "emdash";
import type { PluginContext, RouteContext } from "emdash";
import { aiConfig } from "../jobs/ai.ts";
import { backgroundTick, drainQueue, jobQueue } from "../jobs/index.ts";
import type { Job } from "../jobs/queue.ts";
import type { DraftWriter, KnownQuestion } from "../jobs/quiz-drafts.ts";
import { daysBefore, dhakaDay } from "../comics/store.ts";
import { hubSettings, staffAuth, visits } from "../staff/index.ts";
import { DEFAULT_THEME_SETTING, THEMES, THEME_SETTING_KEY, resolveTheme, themeById } from "../utils/theme.ts";

const TICK = "tick";

/** Quiz drafts land as unapproved drafts through the plugin's content access. */
function draftWriter(ctx: PluginContext): DraftWriter | null {
	const content = ctx.content;
	const create = content?.create;
	if (!content || !create) return null;
	return {
		async existingQuestions() {
			const out: KnownQuestion[] = [];
			let cursor: string | undefined;
			do {
				const page = await content.list("quiz_questions", { limit: 100, cursor });
				for (const { data } of page.items) {
					if (typeof data.question !== "string") continue;
					const choice = Array.isArray(data.choices) ? data.choices[Number(data.correct_choice) - 1] : undefined;
					const label = typeof choice === "object" && choice !== null ? Reflect.get(choice, "label") : undefined;
					out.push({ question: data.question, answer: typeof label === "string" ? label : null });
				}
				cursor = page.hasMore ? page.cursor : undefined;
			} while (cursor);
			return out;
		},
		async saveDraft(d) {
			await create.call(content, "quiz_questions", {
				question: d.question,
				choices: d.choices.map((label) => ({ label })),
				correct_choice: d.correct,
				explanation: d.explanation ?? "",
				approved: false,
			});
		},
	};
}

function input(ctx: RouteContext): { type: string; page?: string; action_id?: string; values: Record<string, unknown> } {
	const i = ctx.input;
	const get = (k: string) => (typeof i === "object" && i !== null ? Reflect.get(i, k) : undefined);
	const values = get("values");
	return {
		type: String(get("type") ?? ""),
		page: typeof get("page") === "string" ? String(get("page")) : undefined,
		action_id: typeof get("action_id") === "string" ? String(get("action_id")) : undefined,
		values: typeof values === "object" && values !== null ? { ...values } : {},
	};
}

const when = (ms: number | null) => (ms ? new Date(ms).toISOString() : "");
const short = (s: string | null, n = 140) => (s && s.length > n ? `${s.slice(0, n - 1)}\u2026` : (s ?? ""));

function jobRow(j: Job) {
	const took = j.startedAt && j.finishedAt ? `${Math.max(1, Math.round((j.finishedAt - j.startedAt) / 1000))} s` : "";
	return {
		id: String(j.id),
		kind: j.kind,
		status: j.status,
		created: when(j.createdAt),
		took,
		result: j.status === "failed" ? short(j.error) : short(j.output),
	};
}

function jobsPage(notice?: { title: string; description: string; variant?: "default" | "alert" | "error" }) {
	const config = aiConfig();
	const counts = jobQueue().counts();
	return {
		blocks: [
			{ type: "header", text: "AI jobs" },
			...(notice ? [{ type: "banner", ...notice }] : []),
			{
				type: "fields",
				fields: [
					{ label: "Text model (AI_TEXT_URL)", value: config.textUrl ?? "Not configured" },
					{ label: "Image model (AI_IMAGE_URL)", value: config.imageUrl ?? "Not configured" },
				],
			},
			{
				type: "context",
				text: "One job runs at a time. Text jobs stop after 60 s; image jobs only run 20:00\u201308:00 Dhaka time.",
			},
			{
				type: "stats",
				items: [
					{ label: "Queued", value: String(counts.queued) },
					{ label: "Running", value: String(counts.running) },
					{ label: "Done", value: String(counts.done) },
					{ label: "Failed", value: String(counts.failed) },
				],
			},
			{
				type: "form",
				block_id: "test",
				fields: [{ type: "text_input", action_id: "prompt", label: "Test prompt", multiline: true }],
				submit: { label: "Queue test prompt", action_id: "test" },
			},
			{ type: "actions", elements: [{ type: "button", label: "Refresh", action_id: "refresh" }] },
			{
				type: "table",
				columns: [
					{ key: "id", label: "#" },
					{ key: "kind", label: "Job" },
					{ key: "status", label: "Status", format: "badge" },
					{ key: "created", label: "Queued", format: "relative_time" },
					{ key: "took", label: "Took" },
					{ key: "result", label: "Output or error" },
				],
				rows: jobQueue().list(25).map(jobRow),
				page_action_id: "jobs_page",
				empty_text: "No jobs yet.",
			},
		],
	};
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthDay = (mmdd: string) => `${Number(mmdd.slice(3))} ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}`;

function themePage(notice?: { title: string; description: string; variant?: "default" | "alert" | "error" }) {
	const saved = hubSettings().get(THEME_SETTING_KEY);
	const setting = saved === "random" || (saved && themeById(saved)) ? saved : DEFAULT_THEME_SETTING;
	const today = themeById(resolveTheme(new Date(), saved));
	return {
		blocks: [
			{ type: "header", text: "Theme" },
			...(notice ? [{ type: "banner", ...notice }] : []),
			{ type: "fields", fields: [{ label: "Today's theme", value: today ? `${today.label} ${today.emoji}` : "" }] },
			{
				type: "form",
				block_id: "theme",
				fields: [
					{
						type: "select",
						action_id: "theme",
						label: "Theme",
						initial_value: setting,
						options: [
							{ label: "Auto (weekday colour, special days)", value: DEFAULT_THEME_SETTING },
							{ label: "Random each day", value: "random" },
							...THEMES.map((t) => ({ label: t.label, value: t.id })),
						],
					},
				],
				submit: { label: "Save", action_id: "save_theme" },
			},
			{ type: "context", text: "Auto uses the weekday colour, or the special theme on these days (Dhaka time):" },
			{
				type: "fields",
				fields: THEMES.filter((t) => t.date).map((t) => ({ label: t.label, value: monthDay(t.date ?? "") })),
			},
		],
	};
}

const METRIC_DAYS = 30;

async function activePeople(ctx: PluginContext): Promise<{ id: string; name: string }[]> {
	const content = ctx.content;
	if (!content) return [];
	const out: { id: string; name: string }[] = [];
	let cursor: string | undefined;
	do {
		const page = await content.list("people", { limit: 100, cursor });
		for (const { id, data } of page.items) {
			if (data.active === false || typeof data.name !== "string") continue;
			const preferred = typeof data.preferred_name === "string" ? data.preferred_name.trim() : "";
			out.push({ id, name: preferred || data.name });
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return out;
}

async function metricsPage(ctx: PluginContext) {
	const today = dhakaDay(new Date());
	const from = daysBefore(today, METRIC_DAYS - 1);
	const v = visits();
	const people = await activePeople(ctx);
	const activity = new Map(v.people(from, today).map((a) => [a.personId, a]));
	const withPin = people.filter((p) => staffAuth().pinSetAt(p.id)).length;
	const daily = v.daily(from, today);
	const todayStats = daily.find((d) => d.day === today);
	const seen = people.filter((p) => activity.get(p.id)?.days);
	const rows = people
		.map((p) => {
			const a = activity.get(p.id);
			return {
				name: p.name,
				last: a?.lastDay ?? "Never",
				days: String(a?.days ?? 0),
				views: String(a?.views ?? 0),
				pin: staffAuth().pinSetAt(p.id) ? "Set" : "Not set",
			};
		})
		.sort((a, b) => (a.last === b.last ? a.name.localeCompare(b.name) : a.last === "Never" ? 1 : b.last === "Never" ? -1 : b.last.localeCompare(a.last)));
	return {
		blocks: [
			{ type: "header", text: "Metrics" },
			{
				type: "context",
				text: `Page views on the hub, last ${METRIC_DAYS} days (Dhaka time). A visitor is one browser; staff are named only while signed in.`,
			},
			{
				type: "stats",
				items: [
					{ label: "Visitors today", value: String(todayStats?.visitors ?? 0), description: `${todayStats?.signedIn ?? 0} signed in` },
					{ label: `Visitors, ${METRIC_DAYS} days`, value: String(v.uniqueVisitors(from, today)) },
					{ label: "Staff seen signed in", value: `${seen.length} / ${people.length}`, description: `last ${METRIC_DAYS} days` },
					{ label: "PINs set", value: `${withPin} / ${people.length}` },
				],
			},
			{ type: "header", text: "Staff" },
			{
				type: "table",
				columns: [
					{ key: "name", label: "Name" },
					{ key: "last", label: "Last visit (signed in)" },
					{ key: "days", label: `Days active (${METRIC_DAYS} d)` },
					{ key: "views", label: `Page views (${METRIC_DAYS} d)` },
					{ key: "pin", label: "PIN", format: "badge" },
				],
				rows,
				page_action_id: "metrics_people",
				empty_text: "No active people.",
			},
			{ type: "header", text: "By day" },
			{
				type: "table",
				columns: [
					{ key: "day", label: "Day" },
					{ key: "visitors", label: "Visitors" },
					{ key: "signedIn", label: "Signed in" },
					{ key: "views", label: "Page views" },
					{ key: "quizAnswers", label: "Quiz answers" },
				],
				rows: daily.map((d) => ({
					day: d.day,
					visitors: String(d.visitors),
					signedIn: String(d.signedIn),
					views: String(d.views),
					quizAnswers: String(d.quizAnswers),
				})),
				page_action_id: "metrics_days",
				empty_text: "No visits yet.",
			},
			{ type: "header", text: "By page" },
			{
				type: "table",
				columns: [
					{ key: "page", label: "Page" },
					{ key: "views", label: `Views (${METRIC_DAYS} d)` },
				],
				rows: v.pages(from, today).map((p) => ({ page: p.page, views: String(p.views) })),
				page_action_id: "metrics_pages",
				empty_text: "No page views yet.",
			},
		],
	};
}

async function adminRoute(ctx: RouteContext) {
	const i = input(ctx);
	if (i.page === "/metrics") return metricsPage(ctx);
	if (i.page === "/theme") {
		if (i.type === "form_submit" && i.action_id === "save_theme") {
			const value = i.values.theme;
			if (typeof value !== "string" || !(value === DEFAULT_THEME_SETTING || value === "random" || themeById(value))) {
				return themePage({ title: "Pick a theme from the list.", description: "", variant: "alert" });
			}
			hubSettings().set(THEME_SETTING_KEY, value);
			return { ...themePage(), toast: { type: "success", message: "Theme saved" } };
		}
		return themePage();
	}
	if (i.type === "form_submit" && i.action_id === "test") {
		const prompt = typeof i.values.prompt === "string" ? i.values.prompt.trim() : "";
		if (!prompt) return jobsPage({ title: "Type a prompt first.", description: "", variant: "alert" });
		const id = jobQueue().enqueue("test", "text", { prompt }, new Date());
		void drainQueue(draftWriter(ctx));
		return {
			...jobsPage({ title: `Test job #${id} queued`, description: "Press Refresh in a few seconds to see the answer." }),
			toast: { type: "success", message: "Test prompt queued" },
		};
	}
	return jobsPage();
}

export function createPlugin() {
	return definePlugin({
		id: "hub-jobs",
		version: "1.0.0",
		displayName: "Hub background jobs",
		description: "Runs the hub's background work every minute: AI jobs, the daily comic and tea stats.",
		capabilities: ["content:read", "content:write"],
		admin: {
			pages: [
				{ path: "/jobs", label: "AI jobs" },
				{ path: "/theme", label: "Theme" },
				{ path: "/metrics", label: "Metrics" },
			],
		},
		hooks: {
			"plugin:activate": async (_event, ctx) => {
				await ctx.cron?.schedule(TICK, { schedule: "* * * * *" });
			},
			cron: async (event, ctx) => {
				if (event.name === TICK) await backgroundTick(new Date(), draftWriter(ctx));
			},
		},
		routes: {
			admin: { handler: adminRoute },
		},
	});
}
