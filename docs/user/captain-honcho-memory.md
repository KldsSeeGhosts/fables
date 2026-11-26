# Duet long-term memory with Honcho

Duets can use an optional Honcho memory server for long-term recall. When configured, the server mirrors your messages and the Duet's final answers to Honcho, adds a short long-term memory section to Duet briefings, and includes Honcho recall in `captain_memory_search` after the Duet's local memories.

This is off by default. Local Duet memories, NOTES.md, and ordinary threads are unchanged. Clients and mobile apps do not connect to Honcho directly.

## Configure it

Create `~/.config/ksg-code/honcho.json`, or set `T3CODE_HONCHO_CONFIG` to another JSON file:

```json
{
  "baseUrl": "http://honcho.example.test:port",
  "workspaceId": "your-workspace",
  "tokenFile": "/path/to/honcho-token"
}
```

`tokenFile` must contain only the workspace bearer token. Keep that file private. Fables logs a warning if it cannot read the configured file or token, or if either is invalid. With no default config file, Honcho memory stays off.

Restart the Fables server after adding the file. Mirroring runs in the background. The Duet continues with its local briefing if Honcho fails or takes longer than two seconds to respond.
