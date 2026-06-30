# Data Model: OpenCode Slash Commands

This document describes the data entities and structures used for handling slash commands in the IOTA mobile app and bridge.

## Data Entities

### 1. SlashCommand

Represents a slash command supported by the chat input.

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string` | The slash command identifier (e.g., `"/models"`). |
| `description` | `string` | User-facing description of what the command does. |
| `usage` | `string` | Usage instructions (e.g. `"/models [model-name]"`). |
| `clientOnly` | `boolean` | `true` if handled entirely locally; `false` if sent to the bridge. |

### 2. Conversation (Extension)

The `OpenCodeConversation` object is extended to support a configurable active model.

| Field | Type | Description |
|-------|------|-------------|
| `activeModel` | `string` | (Optional) The active LLM model selected for this conversation (e.g. `github-copilot/gpt-5-mini`). |

### 3. Credentials Store

Represents provider API keys stored securely on the mobile device.

| Key | Type | Description |
|-----|------|-------------|
| `ANTHROPIC_API_KEY` | `string` | Anthropic API key |
| `OPENAI_API_KEY` | `string` | OpenAI API key |
| `GEMINI_API_KEY` | `string` | Google Gemini API key |
| `GROQ_API_KEY` | `string` | Groq API key |
| `OPENROUTER_API_KEY` | `string` | OpenRouter API key |

## State Transitions

### Autocomplete suggestion state
```
[Empty Input] ──(Type "/")──> [Suggestions Visible] ──(Select Command)──> [Input Autocompleted & Focused]
```

### Model selection state
```
[Active Model: Default] ──(Run "/models <new-model>")──> [Active Model: <new-model>] ──(Run Prompt)──> [Spawns CLI with --model <new-model>]
```
