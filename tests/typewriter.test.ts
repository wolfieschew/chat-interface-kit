import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Typewriter } from '../src/lib/typewriter.ts';

describe('typewriter', () => {
	it('renders reduced-motion output immediately', async () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { reduced: true });
		typer.push('Hello');
		assert.equal(text, 'Hello');
		await typer.drain();
		assert.equal(text, 'Hello');
	});
	it('renders queued text progressively and drains fully', async () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1 });
		typer.push('Hello world');
		assert.equal(text, '');
		await typer.drain();
		assert.equal(text, 'Hello world');
	});
	it('keeps up with a large backlog', async () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1 });
		typer.push('x'.repeat(5000));
		await typer.drain();
		assert.equal(text.length, 5000);
	});
	it('stops without rendering the queue', () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1000 });
		typer.push('Hello');
		typer.stop();
		assert.equal(text, '');
	});
	it('flushes the queue immediately', () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1000 });
		typer.push('Hello');
		typer.flush();
		assert.equal(text, 'Hello');
	});
	it('resolves a pending drain after stop and flush', async () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1000 });
		typer.push('Hello');
		const stopped = typer.drain();
		typer.stop();
		await stopped;
		assert.equal(text, '');
		const flushed = typer.drain();
		typer.push('Bye');
		typer.flush();
		await flushed;
		assert.equal(text, 'Bye');
	});
	it('ignores empty chunks', () => {
		let text = '';
		const typer = new Typewriter((chunk) => (text += chunk), { interval: 1000 });
		typer.push('');
		assert.equal(text, '');
		typer.flush();
		assert.equal(text, '');
	});
});
