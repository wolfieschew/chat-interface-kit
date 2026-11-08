export class SseDecoder {
	#buffer = '';
	#data: string[] = [];

	push(chunk: string): string[] {
		this.#buffer += chunk;
		const events: string[] = [];
		while (true) {
			const match = /\r\n|\r|\n/.exec(this.#buffer);
			if (!match) break;
			const event = this.#line(this.#buffer.slice(0, match.index));
			this.#buffer = this.#buffer.slice(match.index + match[0].length);
			if (event !== null) events.push(event);
		}
		return events;
	}

	flush(): string[] {
		if (this.#buffer) {
			const event = this.#line(this.#buffer);
			this.#buffer = '';
			if (event !== null) return [event];
		}
		if (!this.#data.length) return [];
		const event = this.#data.join('\n');
		this.#data = [];
		return [event];
	}

	#line(line: string): string | null {
		if (!line) {
			if (!this.#data.length) return null;
			const event = this.#data.join('\n');
			this.#data = [];
			return event;
		}
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		if (field !== 'data') return null;
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		this.#data.push(value);
		return null;
	}
}
