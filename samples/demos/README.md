# Toolpack SDK Demo

Simple demonstration of Toolpack SDK integration.

## Files

- `index.js` - Basic example with chat mode (simple Q&A)
- `01-simple-text.js` - Agent mode example (now fixed to return actual answers)

## Setup

```bash
# Set API key
export TOOLPACK_OPENAI_KEY="sk-..."

# Run examples
node index.js
node 01-simple-text.js
```

## Important Notes

### Issue 1: Default Mode
The SDK defaults to "chat" mode. To use agent mode with workflows, specify it during initialization:

```javascript
const toolpack = await Toolpack.init({
    provider: "openai",
    defaultMode: "agent"  // Explicitly set agent mode
});
```

### Issue 2: Agent Mode Output (FIXED)
Previously, agent mode returned workflow summaries instead of actual answers. This has been fixed in the latest build. Agent mode now returns the actual AI response from the last completed step.

**Before fix:**
```
Workflow completed. 
Summary: Identify the capital city of France.
Steps:
[COMPLETED] Provide the answer to the capital of France.
```

**After fix:**
```
The capital of France is Paris.
```

## Modes

- **chat** - Simple conversational mode (no workflows, direct answers)
- **agent** - Autonomous mode with workflow planning and step execution
