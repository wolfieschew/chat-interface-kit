<script lang="ts">
	import {
		Check,
		LoaderCircle,
		ChevronDown,
		Eye,
		EyeOff,
		KeyRound,
		Monitor,
		Moon,
		SlidersHorizontal,
		Sun
	} from '@lucide/svelte';
	import { Accordion, Tabs } from 'bits-ui';
	import Modal from '#lib/components/ui/modal.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ProviderModel, ProviderStatus } from '#lib/types.js';
	import type { ConnectProviderInput } from '#lib/provider-client.js';
	import { providers, type ProviderId } from '#lib/providers.js';

	let {
		open = $bindable(false),
		tab = $bindable('preferences'),
		systemPrompt = $bindable(''),
		theme,
		provider,
		models,
		loading = false,
		connectionError = '',
		onconnect,
		ondisconnect,
		ontheme
	}: {
		open?: boolean;
		tab?: string;
		systemPrompt?: string;
		theme: 'light' | 'dark' | 'system';
		provider: ProviderStatus;
		models: ProviderModel[];
		loading?: boolean;
		connectionError?: string;
		onconnect: (input: ConnectProviderInput) => Promise<void>;
		ondisconnect: () => Promise<void>;
		ontheme: (value: 'light' | 'dark' | 'system') => void;
	} = $props();

	let expandedProvider = $state('');
	let baseUrl = $state('');
	let apiKey = $state('');
	let showKey = $state(false);
	let remember = $state(true);
	let action = $state<'connect' | 'disconnect' | null>(null);
	const busy = $derived(action !== null);
	let error = $state('');
	let promptDraft = $state('');
	let promptSaved = $state(false);
	let promptResetTimer: ReturnType<typeof setTimeout>;
	const promptDirty = $derived(promptDraft !== systemPrompt);

	$effect(() => {
		if (open) {
			const activeProvider = provider.providerId ?? 'custom';
			expandedProvider = provider.connected ? activeProvider : '';
			baseUrl = activeProvider === 'custom' ? (provider.baseUrl ?? '') : '';
			remember = provider.connected ? provider.remember : true;
			promptDraft = systemPrompt;
			promptSaved = false;
		} else {
			apiKey = '';
			showKey = false;
			error = '';
		}
	});
	$effect(() => () => clearTimeout(promptResetTimer));

	function savePrompt() {
		if (!promptDirty) return;
		systemPrompt = promptDraft;
		promptSaved = true;
		clearTimeout(promptResetTimer);
		promptResetTimer = setTimeout(() => (promptSaved = false), 2000);
	}

	function changeProvider() {
		apiKey = '';
		showKey = false;
		error = '';
	}

	async function connect(event: SubmitEvent, providerId: ProviderId) {
		event.preventDefault();
		if (busy || loading) return;
		action = 'connect';
		error = '';
		try {
			await onconnect({
				providerId,
				...(providerId === 'custom' ? { baseUrl } : {}),
				apiKey,
				remember
			});
			apiKey = '';
			showKey = false;
		} catch (failure) {
			error = failure instanceof Error ? failure.message : 'Could not connect to the provider.';
		} finally {
			action = null;
		}
	}

	async function disconnect() {
		if (busy || loading) return;
		action = 'disconnect';
		error = '';
		try {
			await ondisconnect();
			apiKey = '';
		} catch (failure) {
			error = failure instanceof Error ? failure.message : 'Could not disconnect.';
		} finally {
			action = null;
		}
	}
</script>

<Modal bind:open title="Settings" class="settings-modal">
	<Tabs.Root bind:value={tab} orientation="vertical" class="settings-layout">
		<Tabs.List class="settings-tabs" aria-label="Settings sections">
			<Tabs.Trigger value="preferences" class="settings-tab"
				><SlidersHorizontal size={15} />General</Tabs.Trigger
			>
			<Tabs.Trigger value="provider" class="settings-tab"
				><KeyRound size={15} />Provider</Tabs.Trigger
			>
		</Tabs.List>
		<Tabs.Content value="preferences" class="settings-panel">
			<div class="form-field">
				<span class="field-label">Appearance</span>
				<div class="appearance-options">
					{#each ['light', 'dark', 'system'] as choice}
						<button
							class="appearance-option"
							class:chosen={theme === choice}
							onclick={() => ontheme(choice as 'light' | 'dark' | 'system')}
							aria-pressed={theme === choice}
						>
							{#if choice === 'light'}<Sun size={18} />{:else if choice === 'dark'}<Moon
									size={18}
								/>{:else}<Monitor size={18} />{/if}
							<span>{choice[0].toUpperCase() + choice.slice(1)}</span>
							{#if theme === choice}<Check size={12} class="appearance-check" />{/if}
						</button>
					{/each}
				</div>
			</div>
			<div class="form-field">
				<label for="system-prompt">System prompt</label>
				<textarea
					id="system-prompt"
					class="system-prompt-input text-input"
					bind:value={promptDraft}
					rows="4"
					placeholder="You are a helpful assistant."></textarea>
				<div class="prompt-save-row">
					{#if promptSaved}<span class="system-prompt-saved" role="status"
							><Check size={14} />Saved</span
						>{/if}
					<Button disabled={!promptDirty} onclick={savePrompt}>Save prompt</Button>
				</div>
			</div>
			<div class="settings-actions"><Button onclick={() => (open = false)}>Done</Button></div>
		</Tabs.Content>
		<Tabs.Content value="provider" class="settings-panel">
			{#if connectionError}<p class="provider-error provider-connection-error" role="alert">
					{connectionError}
				</p>{/if}
			<Accordion.Root
				type="single"
				bind:value={expandedProvider}
				onValueChange={changeProvider}
				disabled={busy || loading}
				class="provider-accordion"
			>
				{#each providers as preset (preset.id)}
					{@const connected = provider.connected && (provider.providerId ?? 'custom') === preset.id}
					<Accordion.Item value={preset.id} class="provider-accordion-item">
						<Accordion.Header class="provider-accordion-heading">
							<Accordion.Trigger class="provider-accordion-trigger">
								<span class="provider-accordion-label">{preset.name}</span>
								{#if connected}<span
										class="connection-dot provider-connected-indicator"
										role="img"
										aria-label="Connected"
										title="Connected"
									></span>{/if}
								<ChevronDown size={15} class="provider-accordion-chevron" />
							</Accordion.Trigger>
						</Accordion.Header>
						<Accordion.Content class="provider-accordion-content" forceMount={false}>
							<form class="provider-form" onsubmit={(event) => connect(event, preset.id)}>
								{#if connected}<p class="provider-status">
										{models.length}
										{models.length === 1 ? 'model' : 'models'} available
									</p>{/if}
								{#if preset.id === 'custom'}
									<div class="form-field">
										<label for="base-url">Base URL</label>
										<input
											id="base-url"
											type="url"
											class="text-input"
											bind:value={baseUrl}
											placeholder="https://your-provider.com/v1"
											autocomplete="url"
											required
											maxlength="512"
											pattern="https://.+"
											disabled={busy || loading}
										/>
									</div>
								{/if}
								<div class="form-field">
									<label for={`api-key-${preset.id}`}>API key</label>
									<div class="password-field">
										<input
											id={`api-key-${preset.id}`}
											data-provider-key
											type={showKey ? 'text' : 'password'}
											class="text-input"
											bind:value={apiKey}
											placeholder={connected
												? 'Enter a new API key to update'
												: preset.id === 'custom'
													? 'Enter your API key'
													: `${preset.name} API key`}
											required
											maxlength="1024"
											disabled={busy || loading}
											autocomplete="off"
											spellcheck={false}
										/>
										<button
											type="button"
											class="icon-button password-toggle"
											onclick={() => (showKey = !showKey)}
											aria-label={showKey ? 'Hide API key' : 'Show API key'}
											>{#if showKey}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</button
										>
									</div>
								</div>
								<label class="remember-option"
									><input type="checkbox" bind:checked={remember} disabled={busy || loading} /><span
										>Remember for 30 days</span
									></label
								>
								{#if error}<p class="provider-error" role="alert">{error}</p>{/if}
								<div class="settings-actions provider-actions">
									{#if connected}<Button
											variant="outline"
											disabled={busy || loading}
											onclick={disconnect}
											>{#if action === 'disconnect'}<LoaderCircle
													size={14}
													class="spin"
												/>{/if}{action === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Button
										>{/if}
									<Button type="submit" disabled={busy || loading}
										>{#if action === 'connect'}<LoaderCircle
												size={14}
												class="spin"
											/>{/if}{action === 'connect'
											? 'Connecting…'
											: connected
												? 'Update connection'
												: 'Connect'}</Button
									>
								</div>
							</form>
						</Accordion.Content>
					</Accordion.Item>
				{/each}
			</Accordion.Root>
		</Tabs.Content>
	</Tabs.Root>
</Modal>
