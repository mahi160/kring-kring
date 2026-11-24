import { definePlugin } from "emdash";
import type { PluginContext, RouteContext } from "emdash";
import { aiConfig } from "../jobs/ai.ts";
import { backgroundTick, drainQueue, jobQueue } from "../jobs/index.ts";
import type { Job } from "../jobs/queue.ts";
import type { DraftWriter, KnownQuestion } from "../jobs/quiz-drafts.ts";
import { hubSettings } from "../staff/index.ts";
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

async function adminRoute(ctx: RouteContext) {
	const i = input(ctx);
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
