---
title: Getting Started
category: guide
---

# Getting Started

Welcome to the documentation!

## Installation

To install the package, run:

```bash
npm install @toolpack-sdk/knowledge
```

## Quick Start

Here's a simple example:

```typescript
import { Knowledge, MemoryProvider } from '@toolpack-sdk/knowledge';

const kb = await Knowledge.create({
  provider: new MemoryProvider(),
  sources: [new MarkdownSource('./docs/**/*.md')],
  embedder: new OllamaEmbedder({ model: 'nomic-embed-text' }),
  description: 'My knowledge base',
});
```

## Configuration

You can configure various options when creating a knowledge base.
