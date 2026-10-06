import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { ReferenceAsset } from '../../shared/contracts.js';

const supportedMimeTypes = new Set<ReferenceAsset['mimeType']>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const formatMimeTypes: Partial<Record<string, ReferenceAsset['mimeType']>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function extensionFor(mimeType: ReferenceAsset['mimeType']): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

async function differenceHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .rotate()
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits += Number(data[offset]) > Number(data[offset + 1]) ? '1' : '0';
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export interface PreparedReferenceAsset {
  buffer: Buffer;
  originalName: string;
  mimeType: ReferenceAsset['mimeType'];
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  perceptualHash: string;
}

export class ReferenceAssetStore {
  public constructor(private readonly root: string) {}

  public async prepare(buffer: Buffer, originalName: string, mimeType: string): Promise<PreparedReferenceAsset> {
    if (!supportedMimeTypes.has(mimeType as ReferenceAsset['mimeType'])) {
      throw new Error('Only JPEG, PNG, and WebP reference images are supported.');
    }
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
      throw new Error('Reference images must be between 1 byte and 8 MiB.');
    }
    const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error('The reference image dimensions are unavailable.');
    const detectedMimeType = metadata.format ? formatMimeTypes[metadata.format] : undefined;
    if (detectedMimeType !== mimeType) {
      throw new Error('The declared MIME type does not match the reference image data.');
    }
    return {
      buffer,
      originalName: path.basename(originalName).slice(0, 255),
      mimeType: mimeType as ReferenceAsset['mimeType'],
      byteSize: buffer.length,
      width: metadata.width,
      height: metadata.height,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      perceptualHash: await differenceHash(buffer),
    };
  }

  public async write(knowledgeId: string, asset: PreparedReferenceAsset): Promise<{ id: string; storagePath: string }> {
    const id = randomUUID();
    const relativePath = path.join('references', knowledgeId, `${asset.sha256}.${extensionFor(asset.mimeType)}`);
    const absolutePath = path.resolve(this.root, relativePath);
    const root = path.resolve(this.root);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Reference asset path escaped its root.');
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, asset.buffer, { flag: 'wx' });
    return { id, storagePath: relativePath };
  }

  public async remove(storagePath: string): Promise<void> {
    const absolutePath = path.resolve(this.root, storagePath);
    const root = path.resolve(this.root);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Reference asset path escaped its root.');
    await rm(absolutePath, { force: true });
  }
}
