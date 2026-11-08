<script lang="ts">
	import {
		Check,
		Eye,
		EyeOff,
		KeyRound,
		Monitor,
		Moon,
		SlidersHorizontal,
		Sun
	} from '@lucide/svelte';
	import { Tabs } from 'bits-ui';
	import Modal from '#lib/components/ui/modal.svelte';
	import { Button } from '#lib/components/ui/button/index.js';

	let {
		open = $bindable(false),
		tab = $bindable('preferences'),
		systemPrompt = $bindable(''),
		theme,
		ontheme
	}: {
		open?: boolean;
		tab?: string;
		systemPrompt?: string;
		theme: 'light' | 'dark' | 'system';
		ontheme: (value: 'light' | 'dark' | 'system') => void;
	} = $props();

	let baseUrl = $state('');
	let apiKey = $state('');
	let showKey = $state(false);
	let remember = $state(true);

	$effect(() => {
		if (!open) {
			apiKey = '';
			showKey = false;
		}
	});
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
					bind:value={systemPrompt}
					rows="4"
					placeholder="You are a helpful assistant."></textarea>
			</div>
			<div class="settings-actions"><Button onclick={() => (open = false)}>Done</Button></div>
		</Tabs.Content>
		<Tabs.Content value="provider" class="settings-panel">
			<div class="form-field">
				<label for="base-url">Base URL</label>
				<input
					id="base-url"
					type="url"
					class="text-input"
					bind:value={baseUrl}
					placeholder="https://your-provider.com/v1"
					autocomplete="url"
				/>
			</div>
			<div class="form-field">
				<label for="api-key">API key</label>
				<div class="password-field">
					<input
						id="api-key"
						type={showKey ? 'text' : 'password'}
						class="text-input"
						bind:value={apiKey}
						placeholder="Enter your API key"
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
				><input type="checkbox" bind:checked={remember} /><span>Remember for 30 days</span></label
			>
			<p class="settings-note">Connections aren’t enabled yet. Your API key isn’t saved.</p>
			<div class="settings-actions"><Button disabled>Connect</Button></div>
		</Tabs.Content>
	</Tabs.Root>
</Modal>
