import { definePlugin } from "emdash";
import type { RouteContext } from "emdash";
import { formatShortDate } from "../utils/dates.ts";
import { staffAuth } from "../staff/index.ts";

const RESET_CONFIRM = {
	title: "Reset this PIN?",
	text: "The old PIN stops working and this person is signed out everywhere.",
	confirm: "Reset PIN",
	deny: "Cancel",
};

function statusBlocks(personId: string) {
	const setAt = staffAuth().pinSetAt(personId);
	return [
		{
			type: "section",
			text: setAt
				? `A PIN was set on ${formatShortDate(setAt)}. It can't be shown again; reset it if it's lost.`
				: "No PIN yet. This person can't sign in to the hub until you generate one.",
		},
		{
			type: "actions",
			elements: [
				setAt
					? { type: "button", label: "Reset PIN", action_id: "issue", style: "danger", confirm: RESET_CONFIRM }
					: { type: "button", label: "Generate PIN", action_id: "issue", style: "primary" },
			],
		},
	];
}

async function pinPanel(ctx: RouteContext) {
	// The host reloads the saved entry and checks edit permission before dispatch.
	const personId = ctx.ui?.entry?.id;
	if (!personId) return { blocks: [{ type: "banner", variant: "alert", description: "Save this person first." }] };

	const input = ctx.input;
	const isIssue =
		typeof input === "object" &&
		input !== null &&
		Reflect.get(input, "type") === "block_action" &&
		Reflect.get(input, "action_id") === "issue";
	if (!isIssue) return { blocks: statusBlocks(personId) };

	const pin = await staffAuth().issuePin(personId);
	return {
		blocks: [
			{
				type: "banner",
				title: `New PIN: ${pin}`,
				description: "Shown only this once. Send it to them on Slack now; they can change it after signing in.",
			},
			...statusBlocks(personId),
		],
		toast: { type: "success", message: "PIN generated" },
	};
}

export function createPlugin() {
	return definePlugin({
		id: "hub-staff",
		version: "1.0.0",
		displayName: "Staff PINs",
		description: "Generates and resets the 4-digit PINs staff use to sign in to the hub.",
		admin: {
			editorPanels: [{ id: "pin", title: "Staff PIN", route: "pin-panel", collections: ["people"] }],
		},
		routes: {
			"pin-panel": { handler: pinPanel },
		},
	});
}
