<script lang="ts">
	import { Check, ChevronDown, LoaderCircle, RotateCw, Search, Sparkles } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import type { ProviderModel } from '#lib/types.js';
	let {
		selected = $bindable(''),
		models = [],
		connected = false,
		loading = false,
		error = '',
		onrefresh
	}: {
		selected?: string;
		models?: ProviderModel[];
		connected?: boolean;
		loading?: boolean;
		error?: string;
		onrefresh: () => void;
	} = $props();
	let open = $state(false);
	let query = $state('');
	const model = $derived(models.find((item) => item.id === selected));
	const filtered = $derived(
		models.filter((item) =>
			`${item.id} ${item.name} ${item.ownedBy ?? ''}`.toLowerCase().includes(query.toLowerCase())
		)
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="model-trigger"
		aria-label={model ? `Choose model, current: ${model.name}` : 'Choose model'}
		>{#if loading}<LoaderCircle size={16} class="spin" />{:else}<Sparkles size={16} />{/if}<span
			>{model?.name ?? 'Select model'}</span
		><ChevronDown size={13} /></Popover.Trigger
	>
	<Popover.Portal
		><Popover.Content class="dropdown-content model-popover" sideOffset={8} align="start">
			<div class="model-search">
				<Search size={15} /><input
					bind:value={query}
					placeholder="Search models…"
					aria-label="Search models"
				/>
				{#if connected}<button
						class="icon-button model-refresh"
						onclick={onrefresh}
						disabled={loading}
						aria-label="Refresh models"
						title="Refresh models"><RotateCw size={14} class={loading ? 'spin' : ''} /></button
					>{/if}
			</div>

			<div class="model-list">
				{#each filtered as item}<button
						class="model-option"
						onclick={() => {
							selected = item.id;
							open = false;
						}}
						aria-pressed={selected === item.id}
						><span class="model-option-icon"><Sparkles size={17} /></span><span
							><strong>{item.name}</strong>{#if item.ownedBy || item.name !== item.id}<small
									>{item.name !== item.id ? item.id : item.ownedBy}</small
								>{/if}</span
						>{#if selected === item.id}<Check size={15} class="model-check" />{/if}</button
					>{/each}
				{#if error}<p class="model-empty model-error" role="alert">{error}</p>
				{:else if !filtered.length}<p class="model-empty">
						{loading
							? 'Loading models…'
							: !connected
								? 'Set up your provider in Settings.'
								: query
									? 'No matching models.'
									: 'No models are available for this key.'}
					</p>{/if}
			</div>
		</Popover.Content></Popover.Portal
	>
</Popover.Root>
