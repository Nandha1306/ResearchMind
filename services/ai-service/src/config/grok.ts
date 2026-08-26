import OpenAI from "openai";

const apiKey = process.env.XAI_API_KEY || process.env.GROQ_API_KEY;

// Fail fast rather than booting with a placeholder key. A service that starts
// without a usable LLM credential can only ever produce failed answers, and a
// sentinel key previously routed callers into a canned "dev" response.
if (!apiKey) {
  throw new Error(
    "XAI_API_KEY (or GROQ_API_KEY) is not configured"
  );
}

// Detect if key is a Groq key (starts with gsk_) or xAI key
const isGroq = apiKey.startsWith("gsk_");

export const XAI_BASE_URL =
  process.env.XAI_BASE_URL ||
  (isGroq ? "https://api.groq.com/openai/v1" : "https://api.x.ai/v1");

export const XAI_MODEL =
  process.env.XAI_MODEL ||
  (isGroq ? "openai/gpt-oss-120b" : "grok-4.5");

/** Configured OpenAI-compatible client pointing to Groq Cloud or xAI API endpoint. */
export const grokClient = new OpenAI({
  apiKey,
  baseURL: XAI_BASE_URL,
});
