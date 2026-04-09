import {
  Knowledge,
  MemoryProvider,
  WebUrlSource,
  ApiDataSource,
  MarkdownSource,
  OllamaEmbedder
} from '../src/index.js';

async function main() {
  console.log('Creating advanced knowledge base...');

  const kb = await Knowledge.create({
    provider: new MemoryProvider(),
    sources: [
      // Web URL source - crawl websites
      new WebUrlSource(['https://example.com', 'https://httpbin.org'], {
        maxDepth: 2,
        delayMs: 1000, // Be respectful to servers
        maxChunkSize: 1500,
      }),

      // API data source - index REST API data
      new ApiDataSource('https://jsonplaceholder.typicode.com/posts', {
        dataPath: '', // Root level array
        contentExtractor: (item: any) => `${item.title}\n\n${item.body}`,
        metadataExtractor: (item: any) => ({
          id: item.id,
          userId: item.userId,
        }),
      }),

      // Traditional markdown source
      new MarkdownSource('./docs/**/*.md'),
    ],
    embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
    description: 'Advanced knowledge base with web crawling, API indexing, and hybrid search',
    streamingBatchSize: 50, // Process in batches for large datasets
    onSync: (event) => {
      if (event.type === 'start') {
        console.log('Starting sync...');
      } else if (event.type === 'complete') {
        console.log(`Sync complete! Indexed ${event.chunksAffected} chunks`);
      }
    },
    onEmbeddingProgress: (event) => {
      console.log(`Embedding progress: ${event.percent}% (${event.current}/${event.total})`);
    },
  });

  console.log('\n=== Semantic Search ===');
  const semanticResults = await kb.query('web development technologies', {
    limit: 3,
    searchType: 'semantic',
  });

  console.log(`Found ${semanticResults.length} semantic results:`);
  for (const result of semanticResults) {
    console.log(`Score: ${result.score.toFixed(3)}`);
    console.log(`Content: ${result.chunk.content.substring(0, 100)}...`);
    console.log(`Source: ${result.chunk.metadata.source}`);
    console.log('---\n');
  }

  console.log('\n=== Keyword Search ===');
  const keywordResults = await kb.query('web development', {
    limit: 3,
    searchType: 'keyword',
  });

  console.log(`Found ${keywordResults.length} keyword results:`);
  for (const result of keywordResults) {
    console.log(`Score: ${result.score.toFixed(3)}`);
    console.log(`Content: ${result.chunk.content.substring(0, 100)}...`);
    console.log(`Source: ${result.chunk.metadata.source}`);
    console.log('---\n');
  }

  console.log('\n=== Hybrid Search ===');
  const hybridResults = await kb.query('web development technologies', {
    limit: 3,
    searchType: 'hybrid',
    semanticWeight: 0.6, // 60% semantic, 40% keyword
  });

  console.log(`Found ${hybridResults.length} hybrid results:`);
  for (const result of hybridResults) {
    console.log(`Score: ${result.score.toFixed(3)}`);
    console.log(`Content: ${result.chunk.content.substring(0, 100)}...`);
    console.log(`Source: ${result.chunk.metadata.source}`);
    console.log('---\n');
  }

  await kb.stop();
}

main().catch(console.error);