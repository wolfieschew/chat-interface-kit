<script lang="ts">
	import {
		ArrowUp,
		FileText,
		LoaderCircle,
		Paperclip,
		Square,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { onDestroy, tick } from 'svelte';
	import { readImageFile } from '#lib/images.js';
	import {
		ATTACHMENT_ACCEPT,
		documentExtension,
		documentMime,
		MAX_ATTACHMENTS_PER_MESSAGE,
		MAX_DOCUMENT_TOTAL_CHARS,
		readDocumentFile
	} from '#lib/documents.js';
	import { formatBytes } from '#lib/history.js';
	import type { MessageDocument, MessageImage } from '#lib/types.js';
	let {
		value = $bindable(''),
		attachments = $bindable<MessageImage[]>([]),
		documents = $bindable<MessageDocument[]>([]),
		generating = false,
		sendDisabled = false,
		sendHint = 'Connect a provider in Settings to start chatting.',
		visionNotice = null,
		onsend,
		onstop,
		onnotice
	}: {
		value?: string;
		attachments?: MessageImage[];
		documents?: MessageDocument[];
		generating?: boolean;
		sendDisabled?: boolean;
		sendHint?: string;
		visionNotice?: { text: string; blocked: boolean } | null;
		onsend?: () => void;
		onstop?: () => void;
		onnotice?: (text: string) => void;
	} = $props();
	let input: HTMLTextAreaElement;
	let fileInput: HTMLInputElement;
	let reading = $state(false);
	let readController: AbortController | undefined;
	const canSend = $derived(
		!reading && (!!value.trim() || attachments.length > 0 || documents.length > 0)
	);
	const fileCount = $derived(attachments.length + documents.length);
	export function cancelReading() {
		readController?.abort();
		readController = undefined;
		reading = false;
	}
	onDestroy(cancelReading);
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
		if (reading || generating || !files.length) return;
		const controller = new AbortController();
		readController = controller;
		reading = true;
		try {
			for (const file of files) {
				if (controller.signal.aborted) return;
				if (attachments.length + documents.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
					onnotice?.('Attach at most 4 files per message.');
					break;
				}
				try {
					if (documentMime(file.name)) {
						const document = await readDocumentFile(file, controller.signal);
						if (controller.signal.aborted) return;
						if (
							documents.reduce((total, item) => total + item.text.length, document.text.length) >
							MAX_DOCUMENT_TOTAL_CHARS
						)
							throw new Error('Attached documents contain too much text. Use smaller sections.');
						documents = [...documents, document];
					} else {
						const image = await readImageFile(file, attachments);
						if (controller.signal.aborted) return;
						attachments = [...attachments, image];
					}
				} catch (error) {
					if (controller.signal.aborted) return;
					onnotice?.(
						`${file.name}: ${error instanceof Error ? error.message : 'The file could not be attached.'}`
					);
				}
			}
		} finally {
			if (readController === controller) {
				reading = false;
				readController = undefined;
			}
		}
	}
	function remove(index: number) {
		attachments = attachments.filter((_, position) => position !== index);
	}
	function ondrop(event: DragEvent) {
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length) {
			event.preventDefault();
			void addFiles(files);
		}
	}
	function onpaste(event: ClipboardEvent) {
		const files = [...(event.clipboardData?.files ?? [])].filter(
			(file) => file.type.startsWith('image/') || documentMime(file.name)
		);
		if (files.length) {
			event.preventDefault();
			void addFiles(files);
		}
	}
</script>

<div class="composer-wrap">
	{#if visionNotice}
		<p class="composer-vision" class:blocked={visionNotice.blocked} role="status">
			<TriangleAlert size={14} /><span>{visionNotice.text}</span>
		</p>
	{/if}
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
			accept={ATTACHMENT_ACCEPT}
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
			disabled={generating || reading || fileCount >= MAX_ATTACHMENTS_PER_MESSAGE}
			onclick={() => fileInput.click()}
			aria-label="Attach files"
			title="Attach images, PDF, Word, or spreadsheets"><Paperclip size={17} /></button
		>
		<div class="composer-body">
			{#if fileCount || reading}
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
								disabled={reading || generating}
								onclick={() => remove(index)}
								aria-label="Remove {attachment.name}"
								title="Remove image"><X size={12} /></button
							>
						</div>
					{/each}
					{#each documents as document, index}
						<div class="attachment-chip document-chip" title={document.name}>
							<FileText size={21} strokeWidth={1.5} />
							<span class="document-info"
								><strong>{document.name}</strong><small
									>{documentExtension(document.name).toUpperCase()} · {formatBytes(
										document.size
									)}</small
								></span
							>
							<button
								type="button"
								class="attachment-remove"
								disabled={reading || generating}
								onclick={() => (documents = documents.filter((_, position) => position !== index))}
								aria-label="Remove {document.name}"
								title="Remove file"><X size={12} /></button
							>
						</div>
					{/each}
					{#if reading}<span class="attachment-reading" role="status"
							><LoaderCircle size={15} />Reading files…</span
						>{/if}
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
