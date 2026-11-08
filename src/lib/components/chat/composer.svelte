<script lang="ts">
	import { ArrowUp, Paperclip, Square, X } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { MAX_IMAGES_PER_MESSAGE, readImageFile } from '#lib/images.js';
	import type { MessageImage } from '#lib/types.js';
	let {
		value = $bindable(''),
		attachments = $bindable<MessageImage[]>([]),
		generating = false,
		sendDisabled = false,
		sendHint = 'Connect a provider in Settings to start chatting.',
		onsend,
		onstop,
		onnotice
	}: {
		value?: string;
		attachments?: MessageImage[];
		generating?: boolean;
		sendDisabled?: boolean;
		sendHint?: string;
		onsend?: () => void;
		onstop?: () => void;
		onnotice?: (text: string) => void;
	} = $props();
	let input: HTMLTextAreaElement;
	let fileInput: HTMLInputElement;
	const canSend = $derived(!!value.trim() || attachments.length > 0);
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
	async function addFiles(files: File[]) {
		const added: MessageImage[] = [...attachments];
		for (const file of files) {
			try {
				added.push(await readImageFile(file, added));
			} catch (error) {
				onnotice?.(error instanceof Error ? error.message : 'The image could not be attached.');
			}
		}
		if (added.length > MAX_IMAGES_PER_MESSAGE) {
			added.length = MAX_IMAGES_PER_MESSAGE;
			onnotice?.('At most 4 images can be attached per message.');
		}
		attachments = added;
	}
	function remove(index: number) {
		attachments = attachments.filter((_, position) => position !== index);
	}
	function ondrop(event: DragEvent) {
		const files = [...(event.dataTransfer?.files ?? [])].filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length) {
			event.preventDefault();
			void addFiles(files);
		}
	}
	function onpaste(event: ClipboardEvent) {
		const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length) {
			event.preventDefault();
			void addFiles(files);
		}
	}
</script>

<div class="composer-wrap">
	<form
		class="composer"
		ondragover={(event) => event.preventDefault()}
		{ondrop}
		onsubmit={(event) => {
			event.preventDefault();
			if (canSend && !generating && !sendDisabled) onsend?.();
		}}
	>
		<input
			type="file"
			accept="image/png,image/jpeg,image/webp,image/gif"
			multiple
			bind:this={fileInput}
			class="sr-only"
			tabindex="-1"
			aria-hidden="true"
			onchange={() => {
				void addFiles([...(fileInput.files ?? [])]);
				fileInput.value = '';
			}}
		/>
		<button
			type="button"
			class="attach-button"
			disabled={generating || attachments.length >= MAX_IMAGES_PER_MESSAGE}
			onclick={() => fileInput.click()}
			aria-label="Attach image"
			title="Attach image"><Paperclip size={17} /></button
		>
		<div class="composer-body">
			{#if attachments.length}
				<div class="composer-attachments">
					{#each attachments as attachment, index}
						<div class="attachment-chip">
							<img
								src={`data:${attachment.mime};base64,${attachment.data}`}
								alt={attachment.name}
							/>
							<button
								type="button"
								class="attachment-remove"
								onclick={() => remove(index)}
								aria-label="Remove {attachment.name}"
								title="Remove image"><X size={12} /></button
							>
						</div>
					{/each}
				</div>
			{/if}
			<textarea
				bind:this={input}
				bind:value
				rows="1"
				placeholder="Message ChatUI…"
				aria-label="Message"
				oninput={resize}
				{onpaste}
				onkeydown={(event) => {
					if (
						event.key === 'Enter' &&
						!event.shiftKey &&
						!event.isComposing &&
						window.matchMedia('(pointer: fine)').matches
					) {
						event.preventDefault();
						if (canSend && !generating && !sendDisabled) onsend?.();
					}
				}}></textarea>
		</div>
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
				disabled={sendDisabled || !canSend}
				aria-label="Send message"
				title={sendDisabled ? sendHint : 'Send message'}
				><ArrowUp size={19} strokeWidth={2} /></button
			>
		{/if}
	</form>
</div>
