import type { MessageImage } from './types.js';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
const RESIZE_THRESHOLD_BYTES = 900 * 1024;
const RESIZE_MAX_DIMENSION = 1600;
const RESIZE_QUALITY = 0.82;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function imageDataUrl(image: MessageImage): string {
	return `data:${image.mime};base64,${image.data}`;
}

export function isImageMime(value: unknown): boolean {
	return typeof value === 'string' && (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function imageByteLength(data: string): number {
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	return Math.floor((data.length * 3) / 4) - padding;
}

export function isBase64Image(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length >= 4 &&
		value.length % 4 === 0 &&
		BASE64_PATTERN.test(value)
	);
}

function readAsBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error('The image could not be read. Please try again.'));
		reader.onload = () => {
			const result = typeof reader.result === 'string' ? reader.result : '';
			const data = result.slice(result.indexOf(',') + 1);
			if (data) resolve(data);
			else reject(new Error('The image could not be read. Please try again.'));
		};
		reader.readAsDataURL(blob);
	});
}

async function shrinkImage(file: File): Promise<{ mime: string; data: string }> {
	const url = URL.createObjectURL(file);
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const element = new Image();
			element.onload = () => resolve(element);
			element.onerror = () => reject(new Error('The image could not be read. Please try again.'));
			element.src = url;
		});
		const longest = Math.max(image.naturalWidth, image.naturalHeight);
		if (!longest) throw new Error('The image could not be read. Please try again.');
		const scale = Math.min(1, RESIZE_MAX_DIMENSION / longest);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
		canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
		const context = canvas.getContext('2d');
		if (!context) throw new Error('The image could not be read. Please try again.');
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/webp', RESIZE_QUALITY)
		);
		if (!blob || !isImageMime(blob.type))
			throw new Error('The image could not be read. Please try again.');
		return { mime: blob.type, data: await readAsBase64(blob) };
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function readImageFile(
	file: File,
	existing: MessageImage[] = []
): Promise<MessageImage> {
	if (!isImageMime(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
	if (file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be 2 MB or smaller.');
	if (
		existing.reduce((total, image) => total + imageByteLength(image.data), 0) + file.size >
		MAX_IMAGE_TOTAL_BYTES
	)
		throw new Error('Total attachments per message must stay under 3 MB.');
	const shrink = file.size > RESIZE_THRESHOLD_BYTES && file.type !== 'image/gif';
	const { mime, data } = shrink ? await shrinkImage(file) : { mime: file.type, data: '' };
	const payload = data || (await readAsBase64(file));
	if (imageByteLength(payload) > MAX_IMAGE_BYTES)
		throw new Error('Each image must be 2 MB or smaller.');
	return { name: file.name || 'image', mime: shrink ? mime : file.type, data: payload };
}
