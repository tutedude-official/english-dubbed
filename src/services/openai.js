const OpenAI = require("openai");
const { OPENAI_API_KEY, GPT_MODEL } = require("../config");

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch (_) {}
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const obj = raw.match(/\{[\s\S]*\}$/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  throw new Error("Model did not return valid JSON");
}

async function callJsonModel(messages, maxTokens = 4096) {
  const response = await client.chat.completions.create({
    model: GPT_MODEL,
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages,
  });
  return safeJsonParse(response.choices[0].message.content);
}

module.exports = { client, callJsonModel, safeJsonParse };
