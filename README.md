# prai

A GitHub Action that uses OpenAI GPT-4 and Claude to perform automated code reviews on pull requests, following the Conventional Comments format.

## Key Features

- **Multi-AI Support**
  - OpenAI GPT-4
  - Anthropic Claude 3
  
- **Structured Reviews**
  - Native GitHub suggestions
  - Conventional Comments format
  - Multiple severity levels
  
- **Two-Step Analysis**
  - Comprehensive initial analysis
  - Detailed file-by-file review
  
- **Advanced Features**
  - Skip validation via comments
  - PR blocking for critical issues
  - Customizable cookbook

## Setup

1. Add API keys as GitHub Secrets:
````
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
````

2. Create the workflow file:

````yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: AI Review
        uses: your-username/ai-code-reviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          AI_PROVIDER: "openai" # or "anthropic"
          COOKBOOK_URL: ${{ secrets.COOKBOOK_URL }}
````

## Configuration Options

- `AI_PROVIDER`: AI provider to use ("openai" or "anthropic")
- `COOKBOOK_URL`: URL to your validation rules cookbook
- `SKIP_VALIDATION`: Comment to skip validation (`// @skip-validation`)

## How It Works

1. Analyzes modified files in the PR
2. Performs two-step analysis:
   - Comprehensive initial context analysis
   - Detailed file-by-file review
3. Generates suggestions using GitHub's native format
4. Applies appropriate severity (critical, warning, info)
5. Allows skipping validations via special comment

## Comment Format

Follows the Conventional Comments pattern:
````
<label> [decorations]: <subject>

[discussion]

Labels: praise, nitpick, suggestion, issue, todo, question, thought, chore, note
Decorations: (blocking), (non-blocking), (if-minor)
````