<script lang="ts">
	import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from '@lucide/svelte';
	import type { Message } from '#lib/types.js';
	import BrandMark from '#lib/components/brand-mark.svelte';
	import Markdown from './markdown.svelte';
	let {
		message,
		onregenerate,
		onnotice
	}: { message: Message; onregenerate?: () => void; onnotice: (text: string) => void } = $props();
	let copied = $state(false);
	let vote = $state<'up' | 'down' | null>(null);
	let resetTimer: ReturnType<typeof setTimeout>;
	async function copy() {
		try {
			await navigator.clipboard.writeText(message.content);
			copied = true;
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => (copied = false), 2000);
		} catch {
			onnotice('Copy is unavailable in this browser. Please select the text to copy it.');
		}
	}
	$effect(() => () => clearTimeout(resetTimer));
</script>

<article
	class:user-message={message.role === 'user'}
	class:assistant-message={message.role === 'assistant'}
	aria-label={message.role === 'user' ? 'Your message' : 'Example assistant response'}
>
	{#if message.role === 'user'}
		<div class="user-bubble">{message.content}</div>
	{:else}
		<BrandMark size={29} class="assistant-avatar" />
		<div class="assistant-content">
			<Markdown content={message.content} />
			{#if message.status === 'streaming'}
				<span class="stream-cursor" aria-label="Generating example response"></span>
			{:else}
				<div class="message-actions">
					<button
						class="icon-button"
						onclick={copy}
						aria-label={copied ? 'Message copied' : 'Copy message'}
						title={copied ? 'Copied' : 'Copy message'}
						>{#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}</button
					>
					<button
						class="icon-button"
						class:selected={vote === 'up'}
						onclick={() => (vote = vote === 'up' ? null : 'up')}
						aria-label="Good response"
						aria-pressed={vote === 'up'}
						title="Good response"><ThumbsUp size={15} /></button
					>
					<button
						class="icon-button"
						class:selected={vote === 'down'}
						onclick={() => (vote = vote === 'down' ? null : 'down')}
						aria-label="Poor response"
						aria-pressed={vote === 'down'}
						title="Poor response"><ThumbsDown size={15} /></button
					>
					{#if onregenerate}<button
							class="icon-button"
							onclick={onregenerate}
							aria-label="Regenerate example response"
							title="Regenerate response"><RotateCcw size={15} /></button
						>{/if}
					{#if message.status === 'stopped'}<span class="message-stopped">Response stopped</span
						>{/if}
				</div>
			{/if}
		</div>
	{/if}
</article>
