<script lang="ts">
	import {
		BookOpen,
		Code2,
		Ellipsis,
		MessageSquare,
		PanelLeftClose,
		PencilLine,
		Plus,
		Search,
		Settings2,
		SquarePen,
		Trash2
	} from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import type { Conversation } from '#lib/types.js';
	import BrandMark from '#lib/components/brand-mark.svelte';
	let {
		conversations,
		activeId,
		isMac = false,
		onnew,
		onsearch,
		onselect,
		onsettings,
		onclose,
		onrename,
		ondelete
	}: {
		conversations: Conversation[];
		isMac?: boolean;
		activeId: string | null;
		onnew: () => void;
		onsearch: () => void;
		onselect: (id: string) => void;
		onsettings: () => void;
		onclose: () => void;
		onrename: (id: string) => void;
		ondelete: (id: string) => void;
	} = $props();
</script>

<div class="sidebar-inner">
	<div class="sidebar-brand">
		<button class="brand-button" onclick={onnew} aria-label="ChatUI home"
			><BrandMark size={30} /><span>ChatUI</span></button
		>
		<button
			class="icon-button sidebar-toggle"
			onclick={onclose}
			aria-label="Close sidebar"
			title="Close sidebar"><PanelLeftClose size={17} /></button
		>
	</div>
	<div class="sidebar-navigation">
		<button class="new-chat-button" onclick={onnew}
			><Plus size={17} /><span>New chat</span><kbd>{isMac ? '⇧ ⌘ O' : 'Ctrl ⇧ O'}</kbd></button
		>
		<button class="search-chat-button" onclick={onsearch}
			><Search size={17} /><span>Search chats</span><kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd></button
		>
	</div>
	<nav class="conversation-history" aria-label="Chat history">
		{#each ['Today', 'Previous 7 days'] as group}
			{@const grouped = conversations.filter((conversation) => conversation.group === group)}
			{#if grouped.length}
				<div class="history-group">
					<h2>{group}</h2>
					{#each grouped as conversation (conversation.id)}
						<div class="conversation-row" class:active={activeId === conversation.id}>
							<button
								class="conversation-link"
								onclick={() => onselect(conversation.id)}
								aria-current={activeId === conversation.id ? 'page' : undefined}
							>
								{#if conversation.icon === 'code'}<Code2
										size={16}
									/>{:else if conversation.icon === 'pen'}<PencilLine
										size={16}
									/>{:else if conversation.icon === 'book'}<BookOpen
										size={16}
									/>{:else}<MessageSquare size={16} />{/if}
								<span>{conversation.title}</span>
							</button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="icon-button conversation-menu"
									aria-label={`Options for ${conversation.title}`}
									><Ellipsis size={17} /></DropdownMenu.Trigger
								>
								<DropdownMenu.Portal
									><DropdownMenu.Content
										class="dropdown-content conversation-options"
										side="bottom"
										align="end"
										sideOffset={4}
									>
										<DropdownMenu.Item
											class="dropdown-item"
											onSelect={() => onrename(conversation.id)}
											><SquarePen size={15} />Rename</DropdownMenu.Item
										>
										<DropdownMenu.Item
											class="dropdown-item danger-item"
											onSelect={() => ondelete(conversation.id)}
											><Trash2 size={15} />Delete chat</DropdownMenu.Item
										>
									</DropdownMenu.Content></DropdownMenu.Portal
								>
							</DropdownMenu.Root>
						</div>
					{/each}
				</div>
			{/if}
		{/each}
		{#if !conversations.length}<p class="history-empty">No conversations yet.</p>{/if}
	</nav>
	<div class="sidebar-footer">
		<button class="sidebar-settings" onclick={onsettings}
			><Settings2 size={17} /><span>Settings</span></button
		>
	</div>
</div>
