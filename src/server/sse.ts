// Server-Sent Events: the text/event-stream format, read as it comes. A
// line can end in one chunk and its CR LF be split across two, so the
// parser keeps what's after the last full line for the next.

export interface ParsedEvent {
  id: string | null;
  event: string;
  data: string;
  retry: number | null;
}

export class SseParser {
  #buf = '';
  #data: string[] = [];
  #event = '';
  #id: string | null = null;
  #retry: number | null = null;
  #has = false;
  #first = true;
  #decoder = new TextDecoder();
  #emit: (e: ParsedEvent) => void;
  /** The last id seen (it stays for the events after it). */
  lastId: string | null = null;

  constructor(emit: (e: ParsedEvent) => void) {
    this.#emit = emit;
  }

  push(chunk: Uint8Array | string) {
    let text = typeof chunk === 'string' ? chunk : this.#decoder.decode(chunk, { stream: true });
    if (this.#first && text) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      this.#first = false;
    }
    this.#buf += text;
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.#buf);
      if (!m) break;
      // A CR at the very end may be half of a CR LF still to come.
      if (m[0] === '\r' && m.index === this.#buf.length - 1) break;
      const line = this.#buf.slice(0, m.index);
      this.#buf = this.#buf.slice(m.index + m[0].length);
      this.#line(line);
    }
  }

  /** The stream ended: an event without its blank line isn't sent (as the
   * spec says). */
  end() {
    this.#buf = '';
  }

  #line(line: string) {
    if (line === '') return this.#dispatch();
    if (line.startsWith(':')) return;
    const c = line.indexOf(':');
    const field = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? '' : line.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        this.#data.push(value);
        this.#has = true;
        break;
      case 'event':
        this.#event = value;
        this.#has = true;
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.#id = value;
          this.lastId = value;
        }
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.#retry = Number(value);
        break;
    }
  }

  #dispatch() {
    const has = this.#has;
    const e: ParsedEvent = { id: this.#id ?? this.lastId, event: this.#event || 'message', data: this.#data.join('\n'), retry: this.#retry };
    this.#data = [];
    this.#event = '';
    this.#id = null;
    this.#retry = null;
    this.#has = false;
    if (has) this.#emit(e);
  }
}
