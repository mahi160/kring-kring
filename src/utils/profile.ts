import { MONTHS } from "./celebrations.ts";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_TEAM = 60;
export const MAX_DESIGNATION = 60;
export const MAX_PHONE = 20;
export const MAX_BIO = 280;

const PHONE = /^[0-9 +-]+$/;

export type ProfileField = "team" | "designation" | "birthday_month" | "birthday_day" | "phone" | "bio" | "photo";

/** What the form shows again after an error: the raw submitted text. */
export interface ProfileValues {
	team: string;
	designation: string;
	birthday_month: string;
	birthday_day: string;
	hide_birthday: boolean;
	phone: string;
	bio: string;
	remove_photo: boolean;
}

export interface ProfileData {
	team: string | null;
	designation: string | null;
	birthday_month: (typeof MONTHS)[number] | null;
	birthday_day: number | null;
	hide_birthday: boolean;
	phone: string | null;
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
		team: text(form, "team"),
		designation: text(form, "designation"),
		birthday_month: text(form, "birthday_month"),
		birthday_day: text(form, "birthday_day"),
		hide_birthday: form.get("hide_birthday") === "on",
		phone: text(form, "phone"),
		bio: text(form, "bio"),
		remove_photo: form.get("remove_photo") === "on",
	};
	const errors: Partial<Record<ProfileField, string>> = {};

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
			team: values.team || null,
			designation: values.designation || null,
			birthday_month: monthIndex >= 0 ? MONTHS[monthIndex] : null,
			birthday_day: values.birthday_month ? day : null,
			hide_birthday: values.hide_birthday,
			phone: values.phone || null,
			bio: values.bio || null,
		},
		photo,
		removePhoto: values.remove_photo && !photo,
		values,
	};
}
