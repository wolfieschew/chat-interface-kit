import type { PreviewModel } from '#lib/types.js';

export const previewModels: PreviewModel[] = [
	{ id: 'balanced', name: 'Balanced', description: 'A little of everything' },
	{ id: 'fast', name: 'Fast', description: 'For everyday questions' },
	{ id: 'reasoning', name: 'Reasoning', description: 'Room to think things through' }
];

export const suggestions = [
	{
		icon: 'pen',
		title: 'Write something',
		description: 'Find the words you’re looking for',
		prompt: 'Help me write a thoughtful introduction for my personal website.'
	},
	{
		icon: 'bulb',
		title: 'Explore an idea',
		description: 'Give your next idea a little space',
		prompt: 'Help me brainstorm a small creative project I can build this weekend.'
	},
	{
		icon: 'code',
		title: 'Build something',
		description: 'Turn a what-if into a first draft',
		prompt: 'Can you help me design a landing page hero section that feels modern and minimal?'
	},
	{
		icon: 'book',
		title: 'Learn something',
		description: 'Make a complicated thing click',
		prompt: 'Explain how browser storage works with a simple, practical example.'
	}
] as const;

export const heroReply = `Absolutely. A strong minimal hero usually comes down to three things. Here’s how I would approach it:

- **One clear headline**, max two lines.
- A single, high-contrast call to action.
- Generous whitespace around the fold.

Start with a simple layout structure:

\`\`\`svelte
<section class="mx-auto max-w-3xl px-6 py-24 text-center">
  <h1 class="text-5xl font-semibold tracking-tight">
    Build faster. Think bigger.
  </h1>
  <p class="mt-4 text-neutral-500">
    A little less noise. A lot more possibility.
  </p>
</section>
\`\`\`

Keep the supporting copy short. Let the headline do the heavy lifting, and give the page room to breathe.`;

export function createPreviewReply(prompt: string): string {
	if (/hero|landing|website|design/i.test(prompt)) return heroReply;
	if (/storage|indexeddb|browser/i.test(prompt))
		return 'Think of browser storage as a small notebook that belongs to this browser.\n\n- **localStorage** is useful for small preferences, such as your theme.\n- **IndexedDB** holds structured data, such as conversations and messages.\n- **Cookies** can be sent to your server with requests, making them useful for sessions.\n\nFor this app, conversations will live in IndexedDB while provider credentials will use an encrypted cookie.\n\n';
	if (/project|brainstorm|weekend/i.test(prompt))
		return 'Let’s keep it small enough to finish and interesting enough to make your own.\n\n1. **A little idea journal** — capture a thought before it disappears.\n2. **A personal link shelf** — collect useful things with a note about why they matter.\n3. **A daily sketch prompt** — one creative starting point each day.\n\nPick the one you would actually use, then build the simplest version of its main interaction.\n\n';
	return 'This is a sample response. Provider connections will be available in **Settings → Provider**.';
}
