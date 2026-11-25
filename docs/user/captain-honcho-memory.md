# Captain long-term memory with Honcho

Captains can use an optional Honcho memory server for long-term recall. When configured, the server mirrors Captain conversation messages to Honcho, adds a short long-term memory section to Captain briefings, and includes Honcho recall in `captain_memory_search` after the Captain's local memories.

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

`tokenFile` must contain only the workspace bearer token. Keep that file private. If the config or token is missing or invalid, KSG Code logs one warning and leaves Honcho memory off.

Restart the KSG server after adding the file. Mirroring and recall are best-effort: a Honcho failure never fails or blocks a Captain turn.
