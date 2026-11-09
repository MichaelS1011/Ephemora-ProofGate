const normalized = String(input.text ?? "").trim().split(/\s+/).filter(Boolean).join(" ").toLowerCase();
const result = { normalized, wordCount: normalized ? normalized.split(" ").length : 0 };
console.log(`RESULT_JSON:${JSON.stringify(result)}`);
