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

const CLEAR_CONFIRM = {
	title: "Clear this PIN?",
	text: "The PIN stops working and this person is signed out everywhere. Whoever signs in as them next chooses a new PIN.",
	confirm: "Clear PIN",
	deny: "Cancel",
};

function statusBlocks(personId: string) {
	const setAt = staffAuth().pinSetAt(personId);
	return [
		{
			type: "section",
			text: setAt
				? `A PIN was set on ${formatShortDate(setAt)}. It can't be shown again. If it's lost or someone else claimed this name, reset it (you send the new PIN) or clear it (they choose a new one at sign-in).`
				: "No PIN yet. They choose one the first time they sign in, or you can generate one for them.",
		},
		{
			type: "actions",
			elements: setAt
				? [
						{ type: "button", label: "Reset PIN", action_id: "issue", style: "danger", confirm: RESET_CONFIRM },
						{ type: "button", label: "Clear PIN", action_id: "clear", style: "danger", confirm: CLEAR_CONFIRM },
					]
				: [{ type: "button", label: "Generate PIN", action_id: "issue", style: "primary" }],
		},
	];
}

async function pinPanel(ctx: RouteContext) {
	// The host reloads the saved entry and checks edit permission before dispatch.
	const personId = ctx.ui?.entry?.id;
	if (!personId) return { blocks: [{ type: "banner", variant: "alert", description: "Save this person first." }] };

	const input = ctx.input;
	const action =
		typeof input === "object" && input !== null && Reflect.get(input, "type") === "block_action"
			? Reflect.get(input, "action_id")
			: null;
	if (action === "clear") {
		staffAuth().clearPin(personId);
		return { blocks: statusBlocks(personId), toast: { type: "success", message: "PIN cleared" } };
	}
	if (action !== "issue") return { blocks: statusBlocks(personId) };

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
		description: "Generates, resets and clears the 4-digit PINs staff use to sign in to the hub.",
		admin: {
			editorPanels: [{ id: "pin", title: "Staff PIN", route: "pin-panel", collections: ["people"] }],
		},
		routes: {
			"pin-panel": { handler: pinPanel },
		},
	});
}
