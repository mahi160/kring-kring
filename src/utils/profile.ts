import { MONTHS } from "./celebrations.ts";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_PREFERRED_NAME = 40;
export const MAX_TEAM = 60;
export const MAX_DESIGNATION = 60;
export const MAX_PHONE = 20;
export const MAX_BIO = 280;
export const MAX_EMAIL = 120;
export const MAX_EMERGENCY_NAME = 80;
export const MAX_RELATION = 40;
export const MAX_SLACK = 80;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const PHONE = /^[0-9 +-]+$/;
// Deliberately loose: one @, something on each side, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLACK = /^[\p{L}\p{N}._-]+$/u;
const GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export type ProfileField =
	| "preferred_name"
	| "team"
	| "designation"
	| "birthday_month"
	| "birthday_day"
	| "phone"
	| "email"
	| "slack"
	| "github"
	| "blood_group"
	| "emergency_name"
	| "emergency_relation"
	| "emergency_phone"
	| "bio"
	| "photo";

/** What the form shows again after an error: the raw submitted text. */
export interface ProfileValues {
	preferred_name: string;
	team: string;
	designation: string;
	birthday_month: string;
	birthday_day: string;
	hide_birthday: boolean;
	phone: string;
	email: string;
	slack: string;
	github: string;
	blood_group: string;
	emergency_name: string;
	emergency_relation: string;
	emergency_phone: string;
	bio: string;
	remove_photo: boolean;
}

export interface ProfileData {
	preferred_name: string | null;
	team: string | null;
	designation: string | null;
	birthday_month: (typeof MONTHS)[number] | null;
	birthday_day: number | null;
	hide_birthday: boolean;
	phone: string | null;
	email: string | null;
	slack: string | null;
	github: string | null;
	blood_group: (typeof BLOOD_GROUPS)[number] | null;
	emergency_name: string | null;
	emergency_relation: string | null;
	emergency_phone: string | null;
	bio: string | null;
}

export interface ProfilePhoto {
	filename: string;
	contentType: "image/jpeg" | "image/png" | "image/webp";
	base64: string;
}

export type ProfileResult =
	| { ok: true; data: ProfileData; photo: ProfilePhoto | null; removePhoto: boolean; values: ProfileValues }
	| { ok: false; errors: Partial<Record<ProfileField, string>>; values: ProfileValues };

/** The real type from the file's first bytes; the browser-sent type is not trusted. */
export function sniffImage(b: Uint8Array): ProfilePhoto["contentType"] | null {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
	const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	return null;
}

export const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

/** 29 Feb is allowed: the birthday exists in leap years. */
const daysIn = (month: number) => new Date(Date.UTC(2024, month + 1, 0)).getUTCDate();

const text = (form: FormData, key: string) => {
	const v = form.get(key);
	return typeof v === "string" ? v.replaceAll("\r\n", "\n").trim() : "";
};

/** Validates the self-service profile form. Only the keys in ProfileData can come out. */
export async function parseProfile(form: FormData): Promise<ProfileResult> {
	const values: ProfileValues = {
		preferred_name: text(form, "preferred_name").replace(/\s+/g, " "),
		team: text(form, "team"),
		designation: text(form, "designation"),
		birthday_month: text(form, "birthday_month"),
		birthday_day: text(form, "birthday_day"),
		hide_birthday: form.get("hide_birthday") === "on",
		phone: text(form, "phone"),
		email: text(form, "email"),
		// People paste "@handle" or a profile URL; keep just the handle.
		slack: text(form, "slack").replace(/^@/, ""),
		github: text(form, "github")
			.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
			.replace(/^@/, "")
			.replace(/\/+$/, ""),
		blood_group: text(form, "blood_group"),
		emergency_name: text(form, "emergency_name"),
		emergency_relation: text(form, "emergency_relation"),
		emergency_phone: text(form, "emergency_phone"),
		bio: text(form, "bio"),
		remove_photo: form.get("remove_photo") === "on",
	};
	const errors: Partial<Record<ProfileField, string>> = {};

	if (values.preferred_name.length > MAX_PREFERRED_NAME)
		errors.preferred_name = `Preferred name can be at most ${MAX_PREFERRED_NAME} characters.`;
	if (values.team.length > MAX_TEAM) errors.team = `Team can be at most ${MAX_TEAM} characters.`;
	if (values.designation.length > MAX_DESIGNATION)
		errors.designation = `Designation can be at most ${MAX_DESIGNATION} characters.`;

	const monthIndex = MONTHS.findIndex((m) => m === values.birthday_month);
	let day: number | null = null;
	if (values.birthday_month && monthIndex < 0) errors.birthday_month = "Pick a month from the list.";
	if (values.birthday_day) {
		day = /^\d{1,2}$/.test(values.birthday_day) ? Number(values.birthday_day) : Number.NaN;
		if (!(day >= 1 && day <= 31)) errors.birthday_day = "Day must be a number from 1 to 31.";
		else if (!values.birthday_month) errors.birthday_month = "Pick the month too.";
		else if (monthIndex >= 0 && day > daysIn(monthIndex))
			errors.birthday_day = `${values.birthday_month} has at most ${daysIn(monthIndex)} days.`;
	} else if (values.birthday_month) {
		errors.birthday_day = "Add the day too.";
	}

	if (values.phone && !PHONE.test(values.phone))
		errors.phone = "Use only digits, spaces, + and -.";
	else if (values.phone.length > MAX_PHONE) errors.phone = `Phone can be at most ${MAX_PHONE} characters.`;

	if (values.email.length > MAX_EMAIL) errors.email = `Email can be at most ${MAX_EMAIL} characters.`;
	else if (values.email && !EMAIL.test(values.email)) errors.email = "Enter an email like name@example.com.";

	if (values.slack.length > MAX_SLACK) errors.slack = `Slack name can be at most ${MAX_SLACK} characters.`;
	else if (values.slack && !SLACK.test(values.slack))
		errors.slack = "Use your Slack display name without spaces, e.g. mahi.";

	if (values.github && !GITHUB.test(values.github))
		errors.github = "Use your GitHub username: letters, digits and single hyphens, up to 39.";

	const bloodGroup = BLOOD_GROUPS.find((g) => g === values.blood_group) ?? null;
	if (values.blood_group && !bloodGroup) errors.blood_group = "Pick a blood group from the list.";

	if (values.emergency_name.length > MAX_EMERGENCY_NAME)
		errors.emergency_name = `Name can be at most ${MAX_EMERGENCY_NAME} characters.`;
	if (values.emergency_relation.length > MAX_RELATION)
		errors.emergency_relation = `Relation can be at most ${MAX_RELATION} characters.`;
	if (values.emergency_phone && !PHONE.test(values.emergency_phone))
		errors.emergency_phone = "Use only digits, spaces, + and -.";
	else if (values.emergency_phone.length > MAX_PHONE)
		errors.emergency_phone = `Phone can be at most ${MAX_PHONE} characters.`;
	else if (!values.emergency_phone && (values.emergency_name || values.emergency_relation))
		errors.emergency_phone = "Add a phone number for your emergency contact.";

	if (values.bio.length > MAX_BIO) errors.bio = `Bio can be at most ${MAX_BIO} characters.`;

	let photo: ProfilePhoto | null = null;
	const file = form.get("photo");
	if (file instanceof File && file.size > 0) {
		if (file.size > MAX_PHOTO_BYTES) {
			errors.photo = "The photo must be 3 MB or smaller.";
		} else {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const contentType = sniffImage(bytes);
			if (!contentType) errors.photo = "The photo must be a JPEG, PNG or WebP image.";
			else
				photo = {
					filename: `profile.${EXTENSION[contentType]}`,
					contentType,
					base64: Buffer.from(bytes).toString("base64"),
				};
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	return {
		ok: true,
		data: {
			preferred_name: values.preferred_name || null,
			team: values.team || null,
			designation: values.designation || null,
			birthday_month: monthIndex >= 0 ? MONTHS[monthIndex] : null,
			birthday_day: values.birthday_month ? day : null,
			hide_birthday: values.hide_birthday,
			phone: values.phone || null,
			email: values.email || null,
			slack: values.slack || null,
			github: values.github || null,
			blood_group: bloodGroup,
			emergency_name: values.emergency_name || null,
			emergency_relation: values.emergency_relation || null,
			emergency_phone: values.emergency_phone || null,
			bio: values.bio || null,
		},
		photo,
		removePhoto: values.remove_photo && !photo,
		values,
	};
}
