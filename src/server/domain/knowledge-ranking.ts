import type { DesignRequest, KnowledgeItem } from '../../shared/contracts.js';

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });

function terms(value: string): Set<string> {
  return new Set(
    [...segmenter.segment(value.toLocaleLowerCase('ja'))]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
      .filter((part) => part.length > 1),
  );
}

export function rankKnowledge(request: DesignRequest, items: KnowledgeItem[]): KnowledgeItem[] {
  const requestTerms = terms(
    [request.prompt, request.audience, request.objective, ...request.concepts, ...request.avoid].join(' '),
  );

  return items
    .map((item) => {
      const itemTerms = terms(
        [item.title, item.summary, item.evidence, ...item.contexts, ...item.concepts].join(' '),
      );
      const overlap = [...itemTerms].filter((term) => requestTerms.has(term)).length;
      const conceptMatches = item.concepts.filter((concept) =>
        request.concepts.some((requestConcept) => requestConcept.toLocaleLowerCase('ja') === concept.toLocaleLowerCase('ja')),
      ).length;
      const evidenceWeight = item.kind === 'anti-pattern' ? 0.5 : 1;
      return { item, score: overlap + conceptMatches * 4 + evidenceWeight };
    })
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, 'ja'))
    .slice(0, 6)
    .map(({ item }) => item);
}
