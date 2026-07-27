/**
 * Splits streaming LLM text into speakable chunks for HTTP TTS fallback.
 *
 * NOT used on the primary ElevenLabs multi-context WebSocket path —
 * WebSocket streams OpenAI text deltas continuously without waiting
 * for sentence / clause / punctuation boundaries.
 */

const SENTENCE_BOUNDARY = /[.!?…](?:["')\]]+)?\s+/u;
const CLAUSE_BOUNDARY = /[,;:]\s+/u;

export class SentenceStreamer {
  private buffer = "";

  push(delta: string): string[] {
    if (!delta) return [];

    this.buffer += delta;
    const ready: string[] = [];

    while (this.buffer.length > 0) {
      const sentenceMatch = SENTENCE_BOUNDARY.exec(this.buffer);
      if (sentenceMatch && sentenceMatch.index !== undefined) {
        const end = sentenceMatch.index + sentenceMatch[0].length;
        const chunk = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end);
        if (chunk) ready.push(chunk);
        continue;
      }

      // Flush a long clause early so first audio is not blocked on a long sentence.
      if (this.buffer.length >= 120) {
        const clauseMatch = CLAUSE_BOUNDARY.exec(this.buffer);
        if (clauseMatch && clauseMatch.index !== undefined) {
          const end = clauseMatch.index + clauseMatch[0].length;
          const chunk = this.buffer.slice(0, end).trim();
          this.buffer = this.buffer.slice(end);
          if (chunk) ready.push(chunk);
          continue;
        }
      }

      break;
    }

    return ready;
  }

  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining || null;
  }

  reset() {
    this.buffer = "";
  }
}
