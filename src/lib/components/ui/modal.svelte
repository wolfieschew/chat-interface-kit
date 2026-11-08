<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils.js';
	let {
		open = $bindable(false),
		title,
		description,
		children,
		class: className
	}: {
		open?: boolean;
		title: string;
		description?: string;
		children: Snippet;
		class?: string;
	} = $props();
	let content = $state<HTMLDivElement | null>(null);
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="modal-overlay" />
		<Dialog.Content
			bind:ref={content}
			class={cn('modal-content', className)}
			onOpenAutoFocus={(event) => {
				const input = content?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
					'input:not([type="checkbox"]), textarea'
				);
				if (input) {
					event.preventDefault();
					input.focus();
				}
			}}
		>
			<div class="modal-heading">
				<Dialog.Title class="modal-title">{title}</Dialog.Title>
				{#if description}<Dialog.Description class="modal-description"
						>{description}</Dialog.Description
					>{/if}
			</div>
			<Dialog.Close class="icon-button modal-close" aria-label="Close dialog"
				><X size={18} /></Dialog.Close
			>
			{@render children()}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
