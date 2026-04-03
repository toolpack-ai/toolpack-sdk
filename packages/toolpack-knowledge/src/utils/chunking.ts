export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitByParagraphs(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);
    const currentTokens = estimateTokens(currentChunk);

    if (currentTokens + paragraphTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export function splitBySentences(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    const currentTokens = estimateTokens(currentChunk);

    if (currentTokens + sentenceTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export function applyOverlap(chunks: string[], overlapTokens: number): string[] {
  if (chunks.length <= 1 || overlapTokens === 0) {
    return chunks;
  }

  const overlappedChunks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    if (i > 0) {
      const prevChunk = chunks[i - 1];
      const words = prevChunk.split(/\s+/);
      const overlapWords = Math.ceil(overlapTokens / 4);
      const overlap = words.slice(-overlapWords).join(' ');
      chunk = overlap + ' ' + chunk;
    }

    overlappedChunks.push(chunk);
  }

  return overlappedChunks;
}

export function splitLargeChunk(text: string, maxTokens: number): string[] {
  const tokens = estimateTokens(text);
  
  if (tokens <= maxTokens) {
    return [text];
  }

  const paragraphChunks = splitByParagraphs(text, maxTokens);
  
  const finalChunks: string[] = [];
  for (const chunk of paragraphChunks) {
    if (estimateTokens(chunk) > maxTokens) {
      finalChunks.push(...splitBySentences(chunk, maxTokens));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}
