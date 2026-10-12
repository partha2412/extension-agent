const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "llama3.1:8b";

export async function callLocalModel(messages, signal, format = "json") {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      format,
      keep_alive: "10m",
      options: { temperature: 0, num_ctx: 8192 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.message?.content ?? "";
}