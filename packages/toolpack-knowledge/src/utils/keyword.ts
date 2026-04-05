export function keywordSearch(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match gets highest score
  if (textLower.includes(queryLower)) {
    return 1.0;
  }

  // Word-level matching
  const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
  if (queryWords.length === 0) {
    return 0.0;
  }

  let matchCount = 0;
  for (const word of queryWords) {
    if (textLower.includes(word)) {
      matchCount++;
    }
  }

  return matchCount / queryWords.length;
}

export function combineScores(semanticScore: number, keywordScore: number, semanticWeight: number = 0.7): number {
  const keywordWeight = 1 - semanticWeight;
  return semanticScore * semanticWeight + keywordScore * keywordWeight;
}