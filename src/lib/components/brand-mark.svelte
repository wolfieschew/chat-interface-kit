<script lang="ts">
	let { size = 28, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 32 32"
	fill="none"
	class={className}
	aria-hidden="true"
>
	<rect width="32" height="32" rx="10" fill="currentColor" />
	<path
		d="M10 9h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
		stroke="var(--background)"
		stroke-width="1.5"
		stroke-linejoin="round"
	/>
	<path d="M12 13h8m-8 4h5" stroke="var(--background)" stroke-width="1.5" stroke-linecap="round" />
</svg>
