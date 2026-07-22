import { createSSEParser } from './sseParse.js';

export class NimClient {
  constructor({ baseUrl, model, apiKey, temperature = 0.8, maxTokens = 300, reasoningEffort = null, extraBody = null }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.reasoningEffort = reasoningEffort;
    // Generic passthrough for backend-specific quirks, e.g. vLLM-served Qwen3 needs
    // { chat_template_kwargs: { enable_thinking: false } } or it burns max_tokens on thinking
    // and never emits content — kept generic rather than special-cased per model family.
    this.extraBody = extraBody;
  }

  /**
   * onToken is additive: omitted, this behaves exactly as before (stream:false, one JSON
   * response). Passed, it switches to stream:true and calls onToken(delta) as text arrives —
   * but still resolves with the same full accumulated string either way, so callers never need
   * to know which mode ran.
   */
  async chatCompletion({ system, messages, temperature, maxTokens, onToken } = {}) {
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: temperature ?? this.temperature,
      max_tokens: maxTokens ?? this.maxTokens,
      stream: Boolean(onToken),
      ...this.extraBody,
    };
    // Reasoning models (e.g. StepFun's step-3.7-flash) burn max_tokens on hidden
    // chain-of-thought unless told to keep it light — this keeps replies actually landing.
    if (this.reasoningEffort) body.reasoning_effort = this.reasoningEffort;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NIM backend request failed: ${res.status} ${res.statusText} ${text}`);
    }

    if (!onToken) {
      const data = await res.json();
      // Some reasoning models return null content when they run out of budget mid-thought
      // rather than an empty string — normalize so downstream callers never see null.
      return data.choices[0].message.content ?? '';
    }

    return this._streamChatCompletion(res, onToken);
  }

  async _streamChatCompletion(res, onToken) {
    const parser = createSSEParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const events = parser.feed(decoder.decode(value, { stream: true }));
      for (const event of events) {
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken(delta);
        }
      }
    }

    return fullText;
  }
}
