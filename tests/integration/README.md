# Integration Tests

This directory contains integration tests for the Toolchain SDK.

## Multimodal Tests

The `multimodal.test.ts` file tests image upload and image input functionality across all built-in providers.

### Running the Tests

#### Option 1: Using the test runner script
```bash
# Set your API keys
export TOOLPACK_TEST_OPENAI_KEY=sk-...
export TOOLPACK_TEST_ANTHROPIC_KEY=sk-ant-...
export TOOLPACK_TEST_GEMINI_KEY=AIza...

# Run the tests
node scripts/test-multimodal.js
```

#### Option 2: Using npm script
```bash
# Set your API keys
export TOOLPACK_TEST_OPENAI_KEY=sk-...
export TOOLPACK_TEST_ANTHROPIC_KEY=sk-ant-...
export TOOLPACK_TEST_GEMINI_KEY=AIza...

# Run the tests
npm run test:multimodal
```

#### Option 3: Using vitest directly
```bash
# Set your API keys
export TOOLPACK_TEST_OPENAI_KEY=sk-...
export TOOLPACK_TEST_ANTHROPIC_KEY=sk-ant-...
export TOOLPACK_TEST_GEMINI_KEY=AIza...

# Run the tests
npx vitest run tests/integration/multimodal.test.ts
```

### Test Coverage

The multimodal tests verify:

1. **Image Input Types**:
   - `ImageFilePart` - Local file path
   - `ImageDataPart` - Base64 data
   - `ImageUrlPart` - HTTP/HTTPS URL

2. **Provider Features**:
   - OpenAI: All input types + file upload API
   - Anthropic: All input types + experimental file upload API
   - Gemini: All input types + file upload API
   - Ollama: All input types (no file upload API)

3. **File Upload APIs**:
   - Upload functionality
   - Delete functionality
   - Capability detection

### Environment Variables

- `TOOLPACK_TEST_OPENAI_KEY`: Your OpenAI API key
- `TOOLPACK_TEST_ANTHROPIC_KEY`: Your Anthropic API key  
- `TOOLPACK_TEST_GEMINI_KEY`: Your Google Gemini API key

### Notes

- Tests are skipped if the corresponding API key is not provided
- Ollama tests require Ollama to be running locally with a vision model (e.g., llava)
- Tests create a small test image file in the temp directory and clean up afterwards
- Each test has a 30-second timeout to handle API latency
