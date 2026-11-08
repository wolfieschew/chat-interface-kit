<script lang="ts">
	import {
		ArrowDown,
		ArrowDownToLine,
		ArrowUpRight,
		BookOpen,
		Check,
		Code2,
		Lightbulb,
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
	import { suggestions } from '#lib/prompts.js';
	import {
		connectProvider,
		disconnectProvider,
		emptyProvider,
		getProviderModels,
		getProviderStatus,
		ProviderRequestError,
		type ConnectProviderInput
	} from '#lib/provider-client.js';
	import type { ProviderId } from '#lib/providers.js';
	import type {
		Conversation,
		Message,
		ProviderConnection,
		ProviderModel,
		ProviderStatus
	} from '#lib/types.js';
	import { streamChat } from '#lib/chat-client.js';
	import { Typewriter } from '#lib/typewriter.js';
	import { deleteConversation, loadConversations, saveConversation } from '#lib/history.js';

	let conversations = $state<Conversation[]>([]);
	let activeId = $state<string | null>(null);
	let desktopSidebar = $state(true);
	let mobileSidebar = $state(false);
	let settingsOpen = $state(false);
	let settingsTab = $state('preferences');
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let selectedModel = $state('');
	let provider = $state<ProviderStatus>({ ...emptyProvider });
	let models = $state<ProviderModel[]>([]);
	let providerLoading = $state(true);
	let providerError = $state('');
	let providerOperation = 0;
	let providerAbort: AbortController | undefined;
	let systemPrompt = $state('');
	let draft = $state('');
	let generating = $state(false);
	let chatAbort: AbortController | undefined;
	let activeTyper: Typewriter | undefined;
	let toast = $state('');
	let renameId = $state<string | null>(null);
	let renameOpen = $state(false);
	let renameTitle = $state('');
	let deleteId = $state<string | null>(null);
	let deleteOpen = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('light');
	let promptRestored = $state(false);
	let systemDark = $state(false);
	let isMac = $state(false);
	let viewport: HTMLDivElement;
	let composer: Composer;
	let stickToBottom = $state(true);
	let toastTimer: ReturnType<typeof setTimeout>;
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
	const sendDisabled = $derived(
		!provider.connected || !selectedModel || providerLoading || generating
	);
	const sendHint = $derived(
		!provider.connected
			? 'Connect a provider in Settings to start chatting.'
			: !selectedModel
				? 'Select a model to start chatting.'
				: 'Send message'
	);

	onMount(() => {
		void restoreProvider();
		void restoreHistory();
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = media.matches;
		const update = (event: MediaQueryListEvent) => (systemDark = event.matches);
		media.addEventListener('change', update);
		try {
			const saved = localStorage.getItem('chatui:theme');
			if (saved === 'light' || saved === 'dark' || saved === 'system') theme = saved;
			const prompt = localStorage.getItem('chatui:system-prompt');
			if (prompt) systemPrompt = prompt;
		} catch {}
		promptRestored = true;
		return () => {
			media.removeEventListener('change', update);
			providerOperation++;
			providerAbort?.abort();
			activeTyper?.stop();
			chatAbort?.abort();
			clearTimeout(toastTimer);
		};
	});

	$effect(() => {
		document.documentElement.classList.toggle('dark', appliedTheme === 'dark');
	});
	$effect(() => {
		if (!promptRestored) return;
		const prompt = systemPrompt;
		try {
			localStorage.setItem('chatui:system-prompt', prompt);
		} catch {}
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
	$effect(() => {
		const providerId = provider.providerId;
		if (provider.connected && providerId && selectedModel) {
			try {
				localStorage.setItem(`chatui:model:${providerId}`, selectedModel);
			} catch {}
		}
	});

	function beginProviderOperation() {
		providerAbort?.abort();
		providerAbort = new AbortController();
		providerLoading = true;
		providerError = '';
		return { id: ++providerOperation, signal: providerAbort.signal };
	}
	function applyConnection(connection: ProviderConnection) {
		const providerId = connection.provider.providerId;
		const changedProvider =
			provider.providerId !== providerId || provider.baseUrl !== connection.provider.baseUrl;
		provider = connection.provider;
		models = connection.models;
		if (changedProvider || !models.some((model) => model.id === selectedModel)) {
			const saved = providerId ? readSavedModel(providerId) : '';
			selectedModel = models.some((model) => model.id === saved) ? saved : (models[0]?.id ?? '');
		}
	}
	function readSavedModel(providerId: ProviderId) {
		try {
			const saved = localStorage.getItem(`chatui:model:${providerId}`);
			return typeof saved === 'string' ? saved : '';
		} catch {
			return '';
		}
	}
	function handleProviderError(failure: unknown) {
		if (failure instanceof DOMException && failure.name === 'AbortError') return;
		providerError =
			failure instanceof Error ? failure.message : 'Could not load provider settings.';
		if (failure instanceof ProviderRequestError && failure.status === 401)
			applyConnection({ provider: { ...emptyProvider }, models: [] });
	}
	async function restoreProvider() {
		const operation = beginProviderOperation();
		try {
			const result = await getProviderStatus(operation.signal);
			if (operation.id !== providerOperation) return;
			provider = result.provider;
			if (provider.connected) {
				const connection = await getProviderModels(operation.signal);
				if (operation.id === providerOperation) applyConnection(connection);
			}
		} catch (failure) {
			if (operation.id === providerOperation) handleProviderError(failure);
		} finally {
			if (operation.id === providerOperation) providerLoading = false;
		}
	}
	async function saveProvider(input: ConnectProviderInput) {
		const operation = beginProviderOperation();
		try {
			const connection = await connectProvider(input, operation.signal);
			if (operation.id === providerOperation) applyConnection(connection);
		} finally {
			if (operation.id === providerOperation) providerLoading = false;
		}
	}
	async function removeProvider() {
		const operation = beginProviderOperation();
		try {
			const connection = await disconnectProvider(operation.signal);
			if (operation.id === providerOperation) applyConnection(connection);
		} finally {
			if (operation.id === providerOperation) providerLoading = false;
		}
	}
	async function refreshModels() {
		if (!provider.connected || providerLoading) return;
		const operation = beginProviderOperation();
		try {
			const connection = await getProviderModels(operation.signal);
			if (operation.id === providerOperation) applyConnection(connection);
		} catch (failure) {
			if (operation.id === providerOperation) handleProviderError(failure);
		} finally {
			if (operation.id === providerOperation) providerLoading = false;
		}
	}

	function conversationTitle(text: string) {
		return text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
	}

	async function restoreHistory() {
		const restored = await loadConversations();
		if (!restored) {
			notice('Chat history is unavailable in this browser.');
			return;
		}
		if (!conversations.length) {
			conversations = restored;
			return;
		}
		const merged = new Map(restored.map((item) => [item.id, item]));
		for (const item of conversations) merged.set(item.id, item);
		conversations = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	function persist(conversation: Conversation) {
		conversation.updatedAt = Date.now();
		void saveConversation($state.snapshot(conversation));
	}

	async function send() {
		const text = draft.trim();
		if (!text || sendDisabled) return;
		let conversation = active;
		if (!conversation) {
			const created: Conversation = {
				id: crypto.randomUUID(),
				title: conversationTitle(text),
				group: 'Today',
				messages: [],
				updatedAt: Date.now()
			};
			conversations = [created, ...conversations];
			activeId = created.id;
			conversation = conversations.find((item) => item.id === created.id) ?? created;
		} else {
			const existing = conversation;
			conversations = [existing, ...conversations.filter((item) => item.id !== existing.id)];
			conversation = conversations.find((item) => item.id === existing.id) ?? existing;
		}
		persist(conversation);
		const history = conversation.messages
			.filter((message) => message.content.trim())
			.map(({ role, content }) => ({ role, content }));
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: text,
			status: 'complete'
		};
		const assistant: Message = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: '',
			status: 'streaming'
		};
		conversation.messages.push(userMessage, assistant);
		const streaming = conversation.messages[conversation.messages.length - 1];
		draft = '';
		stickToBottom = true;
		generating = true;
		chatAbort = new AbortController();
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const typer = new Typewriter((text) => (streaming.content += text), { reduced });
		activeTyper = typer;
		try {
			await streamChat(
				{
					model: selectedModel,
					...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
					messages: [...history, { role: 'user', content: text }]
				},
				{
					signal: chatAbort.signal,
					ondelta: (chunk) => typer.push(chunk)
				}
			);
			await typer.drain();
			streaming.status = chatAbort?.signal.aborted ? 'stopped' : 'complete';
		} catch (failure) {
			if (failure instanceof DOMException && failure.name === 'AbortError') {
				typer.stop();
				streaming.status = 'stopped';
			} else {
				typer.flush();
				streaming.error =
					failure instanceof Error ? failure.message : 'The message could not be delivered.';
				streaming.status = 'stopped';
				if (failure instanceof ProviderRequestError && failure.status === 401)
					applyConnection({ provider: { ...emptyProvider }, models: [] });
			}
		} finally {
			typer.stop();
			if (activeTyper === typer) activeTyper = undefined;
			if (conversations.some((item) => item.id === conversation.id)) persist(conversation);
			generating = false;
			chatAbort = undefined;
			void composer?.focus();
		}
	}

	function stop() {
		activeTyper?.stop();
		chatAbort?.abort();
	}

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
		} catch {}
	}
	function toggleSidebar() {
		if (window.matchMedia('(max-width: 767px)').matches) mobileSidebar = !mobileSidebar;
		else desktopSidebar = !desktopSidebar;
	}
	function newChat() {
		activeId = null;
		draft = '';
		mobileSidebar = false;
		stickToBottom = true;
		void composer?.focus();
	}
	function selectChat(id: string) {
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
			persist(conversation);
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
		if (deleteId) void deleteConversation(deleteId);
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
				><ModelPicker
					bind:selected={selectedModel}
					{models}
					connected={provider.connected}
					loading={providerLoading}
					error={providerError}
					onrefresh={refreshModels}
				/>
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
					{sendDisabled}
					{generating}
					{sendHint}
					onsend={() => void send()}
					onstop={stop}
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
	{provider}
	{models}
	loading={providerLoading}
	connectionError={providerError}
	onconnect={saveProvider}
	ondisconnect={removeProvider}
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
				><span
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
