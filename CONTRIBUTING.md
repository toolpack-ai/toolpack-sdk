# Contributing to Toolpack SDK

First off, thank you for considering contributing to Toolpack SDK! It's people like you that make Toolpack SDK such a great tool.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this open source project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please treat all contributors with respect.

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v20 or higher required)
*   npm (v9 or higher)

### Local Development Setup

1.  **Fork** the repository on GitHub.
2.  **Clone** your fork locally:
    ```bash
    git clone https://github.com/YOUR_USERNAME/toolpack-sdk.git
    cd toolpack-sdk
    ```
3.  **Install dependencies**:
    ```bash
    npm install
    ```
4.  **Create a branch** for your feature or bug fix:
    ```bash
    git checkout -b feature/my-awesome-feature
    # or
    git checkout -b fix/annoying-bug
    ```

## Development Workflow

This project is written in TypeScript and uses `vitest` for testing and `eslint` for linting.

### Scripts provided in `package.json`:

*   `npm run build`: Compiles the TypeScript code into the `/dist` directory.
*   `npm run watch`: Runs the TypeScript compiler in watch mode.
*   `npm run lint`: Runs ESLint across the `/src` directory to catch code style issues.
*   `npm run test`: Runs the Vitest test suite.
*   `npm run test:watch`: Runs Vitest in watch mode.
*   `npm run coverage`: Generates a test coverage report.

There are also specific test commands for individual toolsuites:
*   `npm run test:tools:fs`
*   `npm run test:tools:exec`
*   `npm run test:tools:system`
*   `npm run test:tools:http`
*   `npm run test:tools:web`

### Making Changes

1.  Keep your edits focused on a single feature or bug fix per pull request.
2.  Follow the existing coding style and conventions.
3.  Write self-documenting code and add comments for complex logic.
4.  If you are adding a new tool, ensure you create tests for it in the respective `src/tools/` subdirectory.

## Testing Your Changes

Before submitting a Pull Request, you **must** ensure all tests and linting checks pass.

1.  **Run the linter**:
    ```bash
    npm run lint
    ```
2.  **Run the tests**:
    ```bash
    npm run test
    ```
3.  **Check code coverage** (optional but highly recommended for new features):
    ```bash
    npm run coverage
    ```

## Pull Request Process

1.  Commit your changes with clear, descriptive commit messages.
    *   Good: `feat(tools): add new yaml parser tool`
    *   Bad: `Added some stuff`
2.  Push your branch to your forked repository on GitHub.
3.  Open a Pull Request against the `main` branch of the upstream `toolpack-sdk` repository.
4.  Ensure your PR template is filled out completely. Outline clearly what your PR does and any related issue numbers (e.g., "Fixes #123").
5.  Wait for review. The maintainers may suggest changes. Be prepared to update your PR based on feedback.

## Adding New AI Providers

If your contribution involves adding a new adapter for an AI provider (e.g., Grok, Vertex AI, etc.):
1.  Study the `ProviderAdapter` interface in `src/toolpack.ts`.
2.  Review the dummy example in [docs/examples/custom-adapter.ts](docs/examples/custom-adapter.ts).
3.  Implement your adapter in `src/providers/<provider-name>/index.ts`.
4.  Add unit tests to verify generation, streaming, and tool calling features.

## Reporting Bugs and Requesting Features

When opening an issue, please use the provided templates to ensure we have all the information needed to help you:
*   🐛 [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md)
*   💡 [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md)

## Need Help?

If you have any questions or need guidance on how to implement your idea, please boldly open an Issue on GitHub for discussion before starting the work.

Thank you for your contributions!
