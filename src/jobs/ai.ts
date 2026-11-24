import { prop } from "../utils/cached.ts";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface AiClient {
	/** Text from llama-server's OpenAI-compatible chat endpoint. `schema` constrains output to JSON. */
	chat(messages: ChatMessage[], opts: { signal: AbortSignal; schema?: object; maxTokens?: number }): Promise<string>;
	/** PNG bytes from stable-diffusion.cpp's sd-server. */
	image(prompt: string, opts: { signal: AbortSignal; size: string }): Promise<Uint8Array>;
}

export interface AiConfig {
	textUrl: string | null;
	imageUrl: string | null;
}

/** `AI_TEXT_URL` / `AI_IMAGE_URL`, e.g. http://ai.local:8080 and http://ai.local:7860. Unset turns the feature off. */
export function aiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
	const clean = (v: string | undefined) => (v?.trim() ? v.trim().replace(/\/+$/, "") : null);
	return { textUrl: clean(env.AI_TEXT_URL), imageUrl: clean(env.AI_IMAGE_URL) };
}

// Some models still emit a reasoning block even with reasoning off.
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export function createAiClient(config: AiConfig, fetchImpl: typeof fetch = fetch): AiClient {
	async function post(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
		return res.json();
	}

	return {
		async chat(messages, { signal, schema, maxTokens = 600 }) {
			if (!config.textUrl) throw new Error("AI_TEXT_URL is not set");
			const body = await post(
				`${config.textUrl}/v1/chat/completions`,
				{
					messages,
					temperature: 0.7,
					max_tokens: maxTokens,
					...(schema ? { response_format: { type: "json_schema", json_schema: { schema } } } : {}),
				},
				signal,
			);
			const choices = prop(body, "choices");
			const content = prop(prop(Array.isArray(choices) ? choices[0] : undefined, "message"), "content");
			if (typeof content !== "string") throw new Error("unexpected chat response");
			return stripThinking(content);
		},

		async image(prompt, { signal, size }) {
			if (!config.imageUrl) throw new Error("AI_IMAGE_URL is not set");
			const body = await post(
				`${config.imageUrl}/v1/images/generations`,
				{ prompt, n: 1, size, output_format: "png" },
				signal,
			);
			const data = prop(body, "data");
			const b64 = prop(Array.isArray(data) ? data[0] : undefined, "b64_json");
			if (typeof b64 !== "string" || !b64) throw new Error("unexpected image response");
			return Buffer.from(b64, "base64");
		},
	};
}

/** Parses JSON a model returned, tolerating a ```json fence around it. */
export function parseModelJson(raw: string): unknown {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	return JSON.parse((fenced ? fenced[1] : raw).trim());
}
