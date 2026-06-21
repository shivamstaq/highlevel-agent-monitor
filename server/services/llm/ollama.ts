import type { LLMCompleteOptions, LLMProvider } from './types'

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

  /** True when the Ollama server is reachable. Used for the mock fallback. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      return res.ok
    } catch {
      return false
    }
  }

  async complete(opts: LLMCompleteOptions): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user }
        ],
        format: opts.schema,
        stream: false,
        options: { temperature: 0 }
      }),
      signal: AbortSignal.timeout(120000)
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Ollama request failed (${res.status}): ${detail.slice(0, 300)}`)
    }

    const body = (await res.json()) as { message?: { content?: string } }
    const raw = body.message?.content ?? ''
    return parseJsonContent(raw)
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
