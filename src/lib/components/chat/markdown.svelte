<script lang="ts">
	import { marked, type Token } from 'marked';
	import CodeBlock from './code-block.svelte';
	let { content }: { content: string } = $props();
	const tokens = $derived(marked.lexer(content));
	function safeHref(value: string) {
		try {
			const url = new URL(value);
			return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
		} catch {
			return undefined;
		}
	}
</script>

{#snippet inline(items: Token[] | undefined)}
	{#each items ?? [] as token}
		{#if token.type === 'strong'}
			<strong>{@render inline(token.tokens)}</strong>
		{:else if token.type === 'em'}
			<em>{@render inline(token.tokens)}</em>
		{:else if token.type === 'del'}
			<del>{@render inline(token.tokens)}</del>
		{:else if token.type === 'codespan'}
			<code>{token.text}</code>
		{:else if token.type === 'link'}
			<a href={safeHref(token.href)} target="_blank" rel="noopener noreferrer"
				>{@render inline(token.tokens)}</a
			>
		{:else if token.type === 'br'}
			<br />
		{:else if 'tokens' in token && token.tokens}
			{@render inline(token.tokens)}
		{:else if 'text' in token}
			{token.text}
		{/if}
	{/each}
{/snippet}

{#snippet blocks(items: Token[] | undefined)}
	{#each items ?? [] as token}
		{#if token.type === 'paragraph'}
			<p>{@render inline(token.tokens)}</p>
		{:else if token.type === 'heading'}
			{#if token.depth <= 2}<h3>{@render inline(token.tokens)}</h3>{:else}<h4>
					{@render inline(token.tokens)}
				</h4>{/if}
		{:else if token.type === 'list'}
			{#if token.ordered}
				<ol start={token.start || 1}>
					{#each token.items as item}<li>{@render blocks(item.tokens)}</li>{/each}
				</ol>
			{:else}
				<ul>
					{#each token.items as item}<li>{@render blocks(item.tokens)}</li>{/each}
				</ul>
			{/if}
		{:else if token.type === 'code'}
			<CodeBlock code={token.text} language={token.lang || 'text'} />
		{:else if token.type === 'blockquote'}
			<blockquote>{@render blocks(token.tokens)}</blockquote>
		{:else if token.type === 'table'}
			<div class="table-scroll">
				<table>
					<thead
						><tr
							>{#each token.header as cell}<th>{@render inline(cell.tokens)}</th>{/each}</tr
						></thead
					>
					<tbody
						>{#each token.rows as row}<tr
								>{#each row as cell}<td>{@render inline(cell.tokens)}</td>{/each}</tr
							>{/each}</tbody
					>
				</table>
			</div>
		{:else if token.type === 'hr'}
			<hr />
		{:else if token.type === 'text'}
			{#if token.tokens}{@render inline(token.tokens)}{:else}{token.text}{/if}
		{:else if token.type === 'html'}
			{token.text}
		{/if}
	{/each}
{/snippet}

<div class="markdown">{@render blocks(tokens)}</div>
