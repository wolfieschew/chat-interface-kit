<script lang="ts">
	import {
		ArrowDown,
		ArrowDownToLine,
		ArrowUpRight,
		BookOpen,
		Check,
		Code2,
		Lightbulb,
		MessageSquare,
		PanelLeft,
		PencilLine,
		Search,
		SquarePen,
		Trash2,
		X
	} from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import { onMount, tick } from 'svelte';
	import Sidebar from '#lib/components/chat/sidebar.svelte';
	import Composer from '#lib/components/chat/composer.svelte';
	import ChatMessage from '#lib/components/chat/message.svelte';
	import ModelPicker from '#lib/components/chat/model-picker.svelte';
	import ProviderSettings from '#lib/components/chat/provider-settings.svelte';
	import Modal from '#lib/components/ui/modal.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { createPreviewReply, suggestions } from '#lib/demo.js';
	import type { Conversation } from '#lib/types.js';

	let conversations = $state<Conversation[]>([]);
	let activeId = $state<string | null>(null);
	let desktopSidebar = $state(true);
	let mobileSidebar = $state(false);
	let settingsOpen = $state(false);
	let settingsTab = $state('preferences');
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let selectedModel = $state('balanced');
	let systemPrompt = $state('');
	let draft = $state('');
	let generating = $state(false);
	let toast = $state('');
	let renameId = $state<string | null>(null);
	let renameOpen = $state(false);
	let renameTitle = $state('');
	let deleteId = $state<string | null>(null);
	let deleteOpen = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('light');
	let systemDark = $state(false);
	let isMac = $state(false);
	let viewport: HTMLDivElement;
	let composer: Composer;
	let stickToBottom = $state(true);
	let generationTimer: ReturnType<typeof setInterval> | undefined;
	let toastTimer: ReturnType<typeof setTimeout>;
	let streamingConversationId: string | null = null;
	let streamingMessageId: string | null = null;
	const active = $derived(conversations.find((conversation) => conversation.id === activeId));
	const messages = $derived(active?.messages ?? []);
	const searchResults = $derived(
		conversations.filter((conversation) =>
			`${conversation.title} ${conversation.messages.map((message) => message.content).join(' ')}`
				.toLowerCase()
				.includes(searchQuery.toLowerCase().trim())
		)
	);
	const appliedTheme = $derived(theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

	onMount(() => {
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = media.matches;
		const update = (event: MediaQueryListEvent) => (systemDark = event.matches);
		media.addEventListener('change', update);
		try {
			const saved = localStorage.getItem('chatui:theme');
			if (saved === 'light' || saved === 'dark' || saved === 'system') theme = saved;
		} catch {
			/* Preferences can remain in memory when storage is unavailable. */
		}
		return () => {
			media.removeEventListener('change', update);
			clearInterval(generationTimer);
			clearTimeout(toastTimer);
		};
	});

	$effect(() => {
		document.documentElement.classList.toggle('dark', appliedTheme === 'dark');
	});
	$effect(() => {
		activeId;
		messages.length;
		messages[messages.length - 1]?.content;
		if (stickToBottom)
			void tick().then(() => {
				if (viewport) viewport.scrollTop = viewport.scrollHeight;
			});
	});

	function notice(text: string) {
		toast = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4200);
	}
	function openSettings(tab = 'preferences') {
		settingsTab = tab;
		settingsOpen = true;
		mobileSidebar = false;
	}
	function setTheme(value: 'light' | 'dark' | 'system') {
		theme = value;
		try {
			localStorage.setItem('chatui:theme', value);
		} catch {
			/* Use the preference for this session. */
		}
	}
	function toggleSidebar() {
		if (window.matchMedia('(max-width: 767px)').matches) mobileSidebar = !mobileSidebar;
		else desktopSidebar = !desktopSidebar;
	}
	function stopGeneration() {
		clearInterval(generationTimer);
		if (streamingConversationId && streamingMessageId) {
			const message = conversations
				.find((conversation) => conversation.id === streamingConversationId)
				?.messages.find((message) => message.id === streamingMessageId);
			if (message?.status === 'streaming') message.status = 'stopped';
		}
		generating = false;
		streamingConversationId = null;
		streamingMessageId = null;
	}
	function newChat() {
		stopGeneration();
		activeId = null;
		draft = '';
		mobileSidebar = false;
		stickToBottom = true;
		void composer?.focus();
	}
	function selectChat(id: string) {
		stopGeneration();
		activeId = id;
		draft = '';
		mobileSidebar = false;
		searchOpen = false;
		stickToBottom = true;
	}
	function openSearch() {
		searchQuery = '';
		searchOpen = true;
		mobileSidebar = false;
	}
	function useSuggestion(prompt: string) {
		draft = prompt;
		void composer?.focus();
	}
	function streamReply(conversationId: string, prompt: string) {
		const conversation = conversations.find((item) => item.id === conversationId);
		if (!conversation) return;
		const id = crypto.randomUUID();
		conversation.messages.push({ id, role: 'assistant', content: '', status: 'streaming' });
		streamingConversationId = conversationId;
		streamingMessageId = id;
		generating = true;
		const message = conversation.messages.find((item) => item.id === id)!;
		const chunks = createPreviewReply(prompt).match(/\S+\s*/g) ?? [];
		let cursor = 0;
		generationTimer = setInterval(() => {
			message.content += chunks.slice(cursor, cursor + 3).join('');
			cursor += 3;
			if (cursor >= chunks.length) {
				clearInterval(generationTimer);
				message.status = 'complete';
				generating = false;
				streamingConversationId = null;
				streamingMessageId = null;
			}
		}, 35);
	}
	function send() {
		const content = draft.trim();
		if (!content || generating) return;
		if (!activeId) {
			activeId = crypto.randomUUID();
			conversations.unshift({
				id: activeId,
				title: content.length > 42 ? `${content.slice(0, 42)}…` : content,
				group: 'Today',
				icon: 'message',
				messages: []
			});
		}
		const conversation = conversations.find((item) => item.id === activeId)!;
		conversation.messages.push({ id: crypto.randomUUID(), role: 'user', content });
		draft = '';
		stickToBottom = true;
		streamReply(conversation.id, content);
		void composer?.focus();
	}
	function regenerate() {
		if (!active || generating) return;
		const lastUser = active.messages.findLast((message) => message.role === 'user');
		if (!lastUser) return;
		if (active.messages.at(-1)?.role === 'assistant') active.messages.pop();
		stickToBottom = true;
		streamReply(active.id, lastUser.content);
	}
	function beginRename(id: string) {
		renameId = id;
		renameTitle = conversations.find((item) => item.id === id)?.title ?? '';
		renameOpen = true;
	}
	function rename(event: SubmitEvent) {
		event.preventDefault();
		const conversation = conversations.find((item) => item.id === renameId);
		if (conversation && renameTitle.trim()) {
			conversation.title = renameTitle.trim();
			renameOpen = false;
			notice('Chat renamed.');
		}
	}
	function beginDelete(id: string) {
		deleteId = id;
		deleteOpen = true;
	}
	function deleteChat() {
		if (activeId === deleteId) newChat();
		conversations = conversations.filter((item) => item.id !== deleteId);
		deleteOpen = false;
		notice('Chat deleted.');
	}
	function exportChat() {
		if (!active) return;
		const content = `# ${active.title}\n\n${active.messages.map((message) => `## ${message.role === 'user' ? 'You' : 'ChatUI'}\n\n${message.content}`).join('\n\n')}`;
		const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `${active.title.replace(/[^a-z0-9 -]/gi, '').slice(0, 70) || 'conversation'}.md`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		notice('Conversation exported as Markdown.');
	}
	function keyboard(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey)) return;
		if (event.key.toLowerCase() === 'k') {
			event.preventDefault();
			openSearch();
		}
		if (event.shiftKey && event.key.toLowerCase() === 'o') {
			event.preventDefault();
			newChat();
		}
	}
</script>

<svelte:head>
	<title>ChatUI</title>
	<meta name="description" content="A minimal chat workspace for your own AI provider." />
</svelte:head>
<svelte:window onkeydown={keyboard} />

{#snippet sidebarContent(close: () => void)}
	<Sidebar
		{conversations}
		{activeId}
		{isMac}
		onnew={newChat}
		onsearch={openSearch}
		onselect={selectChat}
		onsettings={() => openSettings()}
		onclose={close}
		onrename={beginRename}
		ondelete={beginDelete}
	/>
{/snippet}

<div class="app-shell" class:sidebar-collapsed={!desktopSidebar}>
	{#if desktopSidebar}<aside class="desktop-sidebar" aria-label="Workspace sidebar">
			{@render sidebarContent(() => (desktopSidebar = false))}
		</aside>{/if}
	<main class="chat-main">
		<header class="chat-header">
			<div class="header-left">
				<button
					class="icon-button header-sidebar-toggle"
					class:desktop-hidden={desktopSidebar}
					onclick={toggleSidebar}
					aria-label="Open sidebar"
					title="Open sidebar"><PanelLeft size={19} /></button
				><ModelPicker bind:selected={selectedModel} />
			</div>
			<div class="header-actions">
				{#if active}<button
						class="icon-button"
						onclick={exportChat}
						aria-label="Export conversation"
						title="Export conversation"><ArrowDownToLine size={17} /></button
					>{/if}
				<button
					class="icon-button mobile-new-chat"
					onclick={newChat}
					aria-label="New chat"
					title="New chat"><SquarePen size={19} /></button
				>
			</div>
		</header>
		<div class="chat-body" class:has-messages={messages.length > 0}>
			<div
				class="conversation-viewport"
				bind:this={viewport}
				onscroll={() => {
					stickToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
				}}
			>
				{#if messages.length}
					<div class="messages-list">
						{#each messages as message, index (message.id)}<ChatMessage
								{message}
								onnotice={notice}
								onregenerate={index === messages.length - 1 &&
								message.role === 'assistant' &&
								!generating
									? regenerate
									: undefined}
							/>{/each}
					</div>
				{:else}
					<div class="welcome-screen">
						<h1>What’s on your mind?</h1>
						<div class="suggestions-grid">
							{#each suggestions as suggestion}
								<button class="suggestion-card" onclick={() => useSuggestion(suggestion.prompt)}>
									{#if suggestion.icon === 'pen'}<PencilLine
											size={15}
										/>{:else if suggestion.icon === 'bulb'}<Lightbulb
											size={15}
										/>{:else if suggestion.icon === 'code'}<Code2 size={15} />{:else}<BookOpen
											size={15}
										/>{/if}
									<span>{suggestion.title}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			{#if !stickToBottom && messages.length}<button
					class="scroll-bottom icon-button"
					onclick={() => {
						stickToBottom = true;
						viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
					}}
					aria-label="Scroll to latest message"><ArrowDown size={17} /></button
				>{/if}
			<div class="composer-dock">
				<Composer
					bind:this={composer}
					bind:value={draft}
					{generating}
					onsend={send}
					onstop={stopGeneration}
				/>
			</div>
		</div>
	</main>
</div>

<Dialog.Root bind:open={mobileSidebar}
	><Dialog.Portal
		><Dialog.Overlay class="mobile-sidebar-overlay" /><Dialog.Content class="mobile-sidebar-content"
			><Dialog.Title class="sr-only">Workspace</Dialog.Title><Dialog.Description class="sr-only"
				>Your conversations and provider settings.</Dialog.Description
			>{@render sidebarContent(() => (mobileSidebar = false))}</Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<ProviderSettings
	bind:open={settingsOpen}
	bind:tab={settingsTab}
	bind:systemPrompt
	{theme}
	ontheme={setTheme}
/>

<Modal bind:open={searchOpen} title="Search chats" class="search-modal">
	<div class="chat-search-field">
		<Search size={18} /><input
			bind:value={searchQuery}
			placeholder="Search conversations…"
			aria-label="Search conversations"
		/><kbd>ESC</kbd>
	</div>
	<div class="search-results">
		{#if !searchQuery}<p class="search-section-label">Recent conversations</p>{/if}
		{#each searchResults as conversation}<button
				class="search-result"
				onclick={() => selectChat(conversation.id)}
				><MessageSquare size={18} /><span
					><strong>{conversation.title}</strong><small
						>{conversation.messages.find((message) => message.role === 'user')?.content}</small
					></span
				><ArrowUpRight size={14} /></button
			>{/each}
		{#if !searchResults.length}<div class="search-no-results">
				<Search size={24} /><strong>No conversations found</strong>
				<p>Try a different word or start a new chat.</p>
			</div>{/if}
	</div>
</Modal>

<Modal bind:open={renameOpen} title="Rename chat" class="small-modal"
	><form onsubmit={rename}>
		<label class="sr-only" for="chat-title">Chat title</label><input
			class="text-input"
			id="chat-title"
			bind:value={renameTitle}
			maxlength="100"
			required
		/>
		<div class="modal-actions">
			<Button variant="outline" onclick={() => (renameOpen = false)}>Cancel</Button><Button
				type="submit"
				disabled={!renameTitle.trim()}>Save name</Button
			>
		</div>
	</form></Modal
>
<Modal bind:open={deleteOpen} title="Delete this chat?" class="small-modal"
	><p class="delete-chat-title">{conversations.find((item) => item.id === deleteId)?.title}</p>
	<div class="modal-actions">
		<Button variant="outline" onclick={() => (deleteOpen = false)}>Keep chat</Button><Button
			onclick={deleteChat}><Trash2 size={14} />Delete chat</Button
		>
	</div></Modal
>

{#if toast}<div class="toast" role="status">
		<Check size={16} /><span>{toast}</span><button
			class="icon-button"
			onclick={() => (toast = '')}
			aria-label="Dismiss notification"><X size={14} /></button
		>
	</div>{/if}
