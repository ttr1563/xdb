import { createHash } from 'node:crypto';

import type { KnowledgeInput } from '../../shared/contracts.js';

export function normalizeTaxonomyValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja').replaceAll(/\s+/g, '-');
}

function normalizedList(values: string[]): string[] {
  return [...new Set(values.map(normalizeTaxonomyValue))].sort((left, right) => left.localeCompare(right, 'ja'));
}

export function knowledgeMetadataFingerprint(input: KnowledgeInput, contexts = input.contexts): string {
  return createHash('sha256').update(JSON.stringify({
    title: input.title.normalize('NFKC').trim(),
    summary: input.summary.normalize('NFKC').trim(),
    kind: input.kind,
    contexts: normalizedList(contexts),
    concepts: normalizedList(input.concepts),
    evidence: input.evidence.normalize('NFKC').trim(),
    sourceType: input.provenance.sourceType,
    sourceUri: input.provenance.sourceUri,
  })).digest('hex');
}

export function perceptualHashDistance(left: string, right: string): number {
  if (!/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) {
    throw new Error('Perceptual hashes must be 64-bit hexadecimal values.');
  }
  let differentBits = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = Number.parseInt(left[index] ?? '0', 16) ^ Number.parseInt(right[index] ?? '0', 16);
    differentBits += difference.toString(2).replaceAll('0', '').length;
  }
  return differentBits;
}
