<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	let { code, language = 'text' }: { code: string; language?: string } = $props();
	let copied = $state(false);
	let copyError = $state(false);
	let resetTimer: ReturnType<typeof setTimeout>;
	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			copyError = false;
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => (copied = false), 2000);
		} catch {
			copyError = true;
		}
	}
	$effect(() => () => clearTimeout(resetTimer));
</script>

<div class="code-block">
	<div class="code-toolbar">
		<span>{language}</span>
		<button onclick={copy} aria-label={copied ? 'Code copied' : 'Copy code'}>
			{#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
			{copyError ? 'Could not copy' : copied ? 'Copied' : 'Copy code'}
		</button>
	</div>
	<pre><code>{code}</code></pre>
</div>
