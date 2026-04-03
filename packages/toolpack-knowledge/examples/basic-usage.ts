import { Knowledge, MemoryProvider, MarkdownSource, OllamaEmbedder } from '../src/index.js';

async function main() {
  console.log('Creating knowledge base...');

  const kb = await Knowledge.create({
    provider: new MemoryProvider(),
    sources: [new MarkdownSource('./examples/docs/**/*.md')],
    embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
    description: 'Example documentation for testing',
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

  console.log('\nQuerying knowledge base...');
  const results = await kb.query('how to install', { limit: 3 });

  console.log(`\nFound ${results.length} results:\n`);
  for (const result of results) {
    console.log(`Score: ${result.score.toFixed(3)}`);
    console.log(`Content: ${result.chunk.content.substring(0, 100)}...`);
    console.log(`Metadata:`, result.chunk.metadata);
    console.log('---\n');
  }

  await kb.stop();
}

main().catch(console.error);
