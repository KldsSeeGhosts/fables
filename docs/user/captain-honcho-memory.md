# Captain long-term memory with Honcho

Captains can use an optional Honcho memory server for long-term recall. When configured, the server mirrors your messages and the Captain's final answers to Honcho, adds a short long-term memory section to Captain briefings, and includes Honcho recall in `captain_memory_search` after the Captain's local memories.

This is off by default. Local Captain memories, NOTES.md, and ordinary threads are unchanged. Clients and mobile apps do not connect to Honcho directly.

## Configure it

Create `~/.config/ksg-code/honcho.json`, or set `T3CODE_HONCHO_CONFIG` to another JSON file:

```json
{
  "baseUrl": "http://honcho.example.test:port",
  "workspaceId": "your-workspace",
  "tokenFile": "/path/to/honcho-token"
}
```

`tokenFile` must contain only the workspace bearer token. Keep that file private. KSG Code logs a warning if it cannot read the configured file or token, or if either is invalid. With no default config file, Honcho memory stays off.

Restart the KSG server after adding the file. Mirroring runs in the background. The Captain continues with its local briefing if Honcho fails or takes longer than two seconds to respond.
