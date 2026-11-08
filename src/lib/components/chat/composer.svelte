<script lang="ts">
	import { ArrowUp, Square } from '@lucide/svelte';
	import { tick } from 'svelte';
	let {
		value = $bindable(''),
		generating = false,
		sendDisabled = false,
		sendHint = 'Connect a provider in Settings to start chatting.',
		onsend,
		onstop
	}: {
		value?: string;
		generating?: boolean;
		sendDisabled?: boolean;
		sendHint?: string;
		onsend?: () => void;
		onstop?: () => void;
	} = $props();
	let input: HTMLTextAreaElement;
	function resize() {
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
	}
	export async function focus() {
		await tick();
		input?.focus();
		resize();
	}
	$effect(() => {
		value;
		resize();
	});
</script>

<div class="composer-wrap">
	<form
		class="composer"
		onsubmit={(event) => {
			event.preventDefault();
			if (value.trim() && !generating && !sendDisabled) onsend?.();
		}}
	>
		<textarea
			bind:this={input}
			bind:value
			rows="1"
			placeholder="Message ChatUI…"
			aria-label="Message"
			oninput={resize}
			onkeydown={(event) => {
				if (
					event.key === 'Enter' &&
					!event.shiftKey &&
					!event.isComposing &&
					window.matchMedia('(pointer: fine)').matches
				) {
					event.preventDefault();
					if (value.trim() && !generating && !sendDisabled) onsend?.();
				}
			}}></textarea>
		{#if generating}
			<button
				type="button"
				class="send-button"
				onclick={() => onstop?.()}
				aria-label="Stop generating"
				title="Stop generating"><Square size={13} fill="currentColor" /></button
			>
		{:else}
			<button
				type="submit"
				class="send-button"
				disabled={sendDisabled || !value.trim()}
				aria-label="Send message"
				title={sendDisabled ? sendHint : 'Send message'}
				><ArrowUp size={19} strokeWidth={2} /></button
			>
		{/if}
	</form>
</div>
