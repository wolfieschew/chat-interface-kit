export type VisionSupport = 'yes' | 'no' | 'unknown';

const KNOWN_TEXT_ONLY = [
	/gpt-3/,
	/gpt-4-32k/,
	/gpt-4-0613/,
	/gpt-4-0125/,
	/o1-mini/,
	/o3-mini/,
	/claude-?(2|1|instant)/,
	/gemini-1\.0/,
	/text-embedding/,
	/embedding/,
	/dall-e/,
	/whisper/,
	/moderation/,
	/davinci/,
	/curie/,
	/babbage/
];

const KNOWN_VISION = [
	/gpt-4o/,
	/gpt-4\.1/,
	/gpt-4-turbo/,
	/gpt-4-vision/,
	/gpt-5/,
	/(^|[^a-z0-9])o[134]/,
	/claude-?(3|4|opus|sonnet|haiku)/,
	/gemini/,
	/grok-2-vision/,
	/grok-4/,
	/llava/,
	/pixtral/,
	/internvl/,
	/minicpm-v/,
	/glm-4v/,
	/deepseek-vl/,
	/llama-3\.2.*vision/,
	/qwen.*vl/,
	/qvq/,
	/phi-3.*vision/,
	/idefics/,
	/molmo/,
	/vision/
];

export function visionSupport(modelId: string): VisionSupport {
	const id = modelId.toLowerCase();
	if (KNOWN_TEXT_ONLY.some((pattern) => pattern.test(id))) return 'no';
	if (KNOWN_VISION.some((pattern) => pattern.test(id))) return 'yes';
	return 'unknown';
}

export function imageInputNotice(model: {
	id: string;
	name?: string;
	vision?: boolean;
}): { text: string; blocked: boolean } | null {
	const displayName = model.name && model.name !== model.id ? model.name : model.id;
	const support =
		typeof model.vision === 'boolean' ? (model.vision ? 'yes' : 'no') : visionSupport(model.id);
	if (support === 'yes') return null;
	if (support === 'no')
		return {
			text: `${displayName} can't read images. The attachment will be ignored by this model.`,
			blocked: true
		};
	return {
		text: `${displayName} may not support image input. The attachment could be ignored.`,
		blocked: false
	};
}
