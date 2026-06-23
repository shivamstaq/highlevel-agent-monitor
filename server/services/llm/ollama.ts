import type { LLMProvider, LLMRequest, LLMResult } from './types'

/**
 * Ollama provider. Uses the /api/chat endpoint with `format` set to the JSON
 * Schema so the local model is constrained to valid JSON output. Works with
 * any chat model; reasoning models (qwen3-style) may wrap output in
 * <think>...</think> blocks, which we strip before parsing.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama'
  readonly model: string

  private readonly baseUrl: string

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.model = model
  }

  /**
   * R2 unified path. Ollama constrains output to the JSON Schema via `format`.
   * There is no tool-calling transport here, so both `json` and `tool` modes use
   * the same constrained-JSON request; we always surface the parsed object as
   * `toolInput` (already-structured) and the raw string as `text` so the seam can
   * use either. Ollama reports `prompt_eval_count`/`eval_count` for usage.
   */
  async generate(req: LLMRequest): Promise<LLMResult> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model || this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ],
        format: req.jsonSchema,
        stream: false,
        options: { temperature: 0, num_predict: req.maxTokens }
      }),
      signal: AbortSignal.timeout(120000)
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Ollama request failed (${res.status}): ${detail.slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }
    const raw = body.message?.content ?? ''
    const parsed = parseJsonContent(raw)
    return {
      text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      toolInput: parsed,
      usage: { input: body.prompt_eval_count ?? 0, output: body.eval_count ?? 0 }
    }
  }
}

/** Strip qwen3-style <think> blocks and parse the remaining JSON. */
function parseJsonContent(raw: string): unknown {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // The model may emit prose around the JSON; extract the outermost object.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('Ollama returned non-JSON content')
  }
}
