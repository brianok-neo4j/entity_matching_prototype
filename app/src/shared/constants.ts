// Shared runtime constants. Types live in types.ts; IPC channel names in
// ipc-channels.ts.

// The model every LLM feature falls back to. Sonnet 5 is chosen over the
// cheaper Haiku 4.5 because its 1024-token prompt-cache floor is a quarter of
// Haiku's 4096 — auto-classify's shared prefix only pays for itself once it
// caches, and on Haiku a typical prefix sits below the floor and is re-sent at
// full price on every call.
export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-5'
