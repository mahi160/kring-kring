import { cached, fetchJson, prop } from "./cached.ts";

export type WeatherIconName =
	| "clear-day"
	| "clear-night"
	| "partly-day"
	| "partly-night"
	| "overcast"
	| "fog"
	| "drizzle"
	| "rain"
	| "heavy-rain"
	| "thunder"
	| "snow";

export interface Weather {
	temperatureC: number;
	condition: string;
	icon: WeatherIconName;
}

export interface AirQuality {
	aqi: number;
	level: string;
	/** Short advice, only when the air is bad enough to act on */
	tip: string | null;
}

const DHAKA = "latitude=23.8103&longitude=90.4125&timezone=Asia%2FDhaka";
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?${DHAKA}&current=temperature_2m,weather_code,is_day`;
const AIR_URL = `https://air-quality-api.open-meteo.com/v1/air-quality?${DHAKA}&current=us_aqi`;

// WMO weather interpretation codes, per the Open-Meteo docs.
const CONDITIONS: Record<number, string> = {
	0: "Clear sky",
	1: "Mainly clear",
	2: "Partly cloudy",
	3: "Overcast",
	45: "Fog",
	48: "Rime fog",
	51: "Light drizzle",
	53: "Drizzle",
	55: "Heavy drizzle",
	56: "Freezing drizzle",
	57: "Freezing drizzle",
	61: "Light rain",
	63: "Rain",
	65: "Heavy rain",
	66: "Freezing rain",
	67: "Freezing rain",
	71: "Light snow",
	73: "Snow",
	75: "Heavy snow",
	77: "Snow grains",
	80: "Light showers",
	81: "Showers",
	82: "Violent showers",
	85: "Snow showers",
	86: "Heavy snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm with hail",
	97: "Heavy thunderstorm",
	99: "Thunderstorm with hail",
};

/** Cartoon icon for a WMO weather code; `isDay` only matters for clear and partly cloudy skies. */
export function weatherIcon(code: number, isDay: boolean): WeatherIconName {
	if (code === 0) return isDay ? "clear-day" : "clear-night";
	if (code === 1 || code === 2) return isDay ? "partly-day" : "partly-night";
	if (code === 45 || code === 48) return "fog";
	if (code >= 51 && code <= 57) return "drizzle";
	if (code === 65 || code === 81 || code === 82) return "heavy-rain";
	if ((code >= 61 && code <= 67) || code === 80) return "rain";
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
	if (code >= 95) return "thunder";
	return "overcast";
}

function parseWeather(body: unknown): Weather {
	const current = prop(body, "current");
	const temperature = prop(current, "temperature_2m");
	const code = prop(current, "weather_code");
	// 0 = night; a response without is_day is treated as day.
	const isDay = prop(current, "is_day") !== 0;
	if (typeof temperature !== "number" || typeof code !== "number" || !(code in CONDITIONS)) {
		throw new Error("unexpected Open-Meteo response");
	}
	return { temperatureC: temperature, condition: CONDITIONS[code], icon: weatherIcon(code, isDay) };
}

interface Options {
	fetchImpl?: typeof fetch;
	now?: () => number;
	url?: string;
}

// US AQI bands (EPA).
export function describeAqi(aqi: number): AirQuality {
	if (aqi <= 50) return { aqi, level: "Good", tip: null };
	if (aqi <= 100) return { aqi, level: "Moderate", tip: null };
	if (aqi <= 150) return { aqi, level: "Unhealthy for sensitive groups", tip: "Sensitive lungs: take it easy outside." };
	if (aqi <= 200) return { aqi, level: "Unhealthy", tip: "Mask up if you're heading out." };
	if (aqi <= 300) return { aqi, level: "Very unhealthy", tip: "Mask up and keep the windows shut." };
	return { aqi, level: "Hazardous", tip: "Stay indoors if you can." };
}

export type AqiMood = "good" | "moderate" | "usg" | "unhealthy" | "very-unhealthy" | "hazardous";

/** The AQI band (same edges as describeAqi) as a mood for the cartoon face. */
export function aqiMood(aqi: number): AqiMood {
	if (aqi <= 50) return "good";
	if (aqi <= 100) return "moderate";
	if (aqi <= 150) return "usg";
	if (aqi <= 200) return "unhealthy";
	if (aqi <= 300) return "very-unhealthy";
	return "hazardous";
}

function parseAir(body: unknown): AirQuality {
	const aqi = prop(prop(body, "current"), "us_aqi");
	if (typeof aqi !== "number") throw new Error("unexpected Open-Meteo air quality response");
	return describeAqi(Math.round(aqi));
}

/** Cached weather getter; resolves to null (never throws) when weather is unavailable. */
export function createWeatherSource({ fetchImpl = fetch, now = Date.now, url = WEATHER_URL }: Options = {}) {
	// Open-Meteo's current values update every 15 minutes.
	return cached(async () => parseWeather(await fetchJson(url, fetchImpl)), { ttlMs: 15 * 60_000, now, label: "Weather" });
}

/** Cached air-quality getter; resolves to null (never throws) when unavailable. */
export function createAirQualitySource({ fetchImpl = fetch, now = Date.now, url = AIR_URL }: Options = {}) {
	// Air quality data is hourly.
	return cached(async () => parseAir(await fetchJson(url, fetchImpl)), { ttlMs: 30 * 60_000, now, label: "Air quality" });
}

export const getDhakaWeather = createWeatherSource();
export const getDhakaAirQuality = createAirQualitySource();
