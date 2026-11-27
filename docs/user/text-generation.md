# Text generation models

Fables writes some text for you: thread titles, commit messages, pull request titles and
descriptions, branch names, Duet morning briefs, and voice transcript cleanup. Pick the model for this in
**Settings → Threads → Text generation model**. **Settings → Source control & issues** and
**Settings → Voice** can each pick a different one. To choose a model for scheduled Duet morning
briefs, use **Settings → Threads → Brief model**.

By default, a coding agent handles these tasks by starting a session per request. Adding a dedicated **text generator** API is usually much faster and cheaper.

## Add a text generator

Open **Settings → Providers → Text generators → Add generator** (stored per environment; API keys support [Secrets](./secrets.md)):

- **OpenAI** or **Anthropic**: Enter an API key.
- **OpenRouter**: Enter an OpenRouter API key to use any model it serves.
- **Custom (OpenAI-compatible)**: Enter a base URL (e.g. Ollama at `http://localhost:11434/v1` or LM Studio—`localhost` resolves on the environment's server).

Click **Test** beside a model picker to verify the key works, or **Show models** to refresh the catalog. Disabling or removing a generator falls back to the environment's default text generation model.

## Limitations

Each request sends the API what the task needs. For a scheduled Duet morning brief, the request
includes excerpts from NOTES.md and DIGEST.md, open requests, and recent delegated work.

Turning a generator off or removing it sends its work back to the environment's text generation
model.

## What text generators can't do

Review guides read the checkout over many steps, so they always use a coding agent. If your source
control writer model is a text generator, review guides use Codex or Claude instead, and fail if
neither is set up. To choose which, pick one in **Settings → Source control & issues → Review guide model**.

A [managed policy](./managed-policy.md) that limits providers also turns off text generators.
