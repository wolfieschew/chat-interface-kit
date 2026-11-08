<script lang="ts">
	import { Check, ChevronDown, Search, Sparkles, Zap, Brain } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import { previewModels } from '#lib/demo.js';
	let { selected = $bindable('balanced') }: { selected?: string } = $props();
	let open = $state(false);
	let query = $state('');
	const model = $derived(previewModels.find((item) => item.id === selected) ?? previewModels[0]);
	const filtered = $derived(
		previewModels.filter((item) =>
			`${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())
		)
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger class="model-trigger" aria-label={`Choose model, current: ${model.name}`}
		><Sparkles size={16} /><span>{model.name}</span><ChevronDown size={13} /></Popover.Trigger
	>
	<Popover.Portal
		><Popover.Content class="dropdown-content model-popover" sideOffset={8} align="start">
			<div class="model-search">
				<Search size={15} /><input
					bind:value={query}
					placeholder="Search models…"
					aria-label="Search models"
				/>
			</div>

			<div class="model-list">
				{#each filtered as item}<button
						class="model-option"
						onclick={() => {
							selected = item.id;
							open = false;
						}}
						aria-pressed={selected === item.id}
						><span class="model-option-icon"
							>{#if item.id === 'fast'}<Zap size={17} />{:else if item.id === 'reasoning'}<Brain
									size={17}
								/>{:else}<Sparkles size={17} />{/if}</span
						><span><strong>{item.name}</strong><small>{item.description}</small></span
						>{#if selected === item.id}<Check size={15} class="model-check" />{/if}</button
					>{/each}
				{#if !filtered.length}<p class="model-empty">No models found.</p>{/if}
			</div>
		</Popover.Content></Popover.Portal
	>
</Popover.Root>
