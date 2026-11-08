type Apply = (text: string) => void;

export class Typewriter {
	#apply: Apply;
	#interval: number;
	#reduced: boolean;
	#pending = '';
	#timer: ReturnType<typeof setInterval> | undefined;
	#idle: (() => void) | undefined;

	constructor(apply: Apply, options: { reduced?: boolean; interval?: number } = {}) {
		this.#apply = apply;
		this.#reduced = options.reduced ?? false;
		this.#interval = options.interval ?? 16;
	}

	push(chunk: string) {
		if (!chunk) return;
		if (this.#reduced) {
			this.#apply(chunk);
			return;
		}
		this.#pending += chunk;
		this.#start();
	}

	drain(): Promise<void> {
		if (this.#reduced || !this.#pending) return Promise.resolve();
		return new Promise((resolve) => {
			this.#idle = resolve;
			this.#start();
		});
	}

	stop() {
		this.#pending = '';
		this.#clear();
		this.#settle();
	}

	flush() {
		if (this.#pending) {
			const text = this.#pending;
			this.#pending = '';
			this.#apply(text);
		}
		this.#clear();
		this.#settle();
	}

	#start() {
		if (this.#timer !== undefined) return;
		this.#timer = setInterval(() => this.#tick(), this.#interval);
	}

	#tick() {
		if (!this.#pending) {
			this.#clear();
			this.#settle();
			return;
		}
		
		const take = Math.max(1, Math.ceil(this.#pending.length / 60));
		const text = this.#pending.slice(0, take);
		this.#pending = this.#pending.slice(take);
		this.#apply(text);
		if (!this.#pending) {
			this.#clear();
			this.#settle();
		}
	}

	#settle() {
		const idle = this.#idle;
		this.#idle = undefined;
		idle?.();
	}

	#clear() {
		if (this.#timer !== undefined) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}
}
