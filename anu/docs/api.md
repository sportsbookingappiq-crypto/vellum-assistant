# ANU API for client developers

This is the API the ANU phone and web clients call. The full schema is in [`../openapi.yaml`](../openapi.yaml). Base URL in local development: `http://127.0.0.1:8787`.

All bodies are JSON. Errors look like this:

```json
{ "error": { "code": "invalid_code", "message": "The code is not valid...", "attemptsRemaining": 3 } }
```

## Sign in

Phone number plus a one-time code ([ADR 0003](decisions/0003-phone-number-login.md)).

1. `POST /v1/auth/code/request` with `{"phone": "+12025550100"}`. Returns `202` and `{"expiresAt": "..."}`.
   - Phone numbers are E.164. Spaces, dashes, dots, and parentheses are stripped.
   - In `dev` and `test` the response also has `devCode`, the code itself. No SMS is sent. In `staging` and `production` the server refuses to start with the dev sender, so `devCode` never appears there.
   - Rate limits: by default 5 requests per phone and 20 per client address in 15 minutes. Over the limit you get `429` with `Retry-After` in seconds.
   - A new request replaces any earlier unused code.
2. `POST /v1/auth/code/verify` with `{"phone": "+12025550100", "code": "123456"}`. Returns `{"token", "tokenType": "Bearer", "expiresAt", "userId"}`.
   - Codes expire after 5 minutes (`code_expired`).
   - Each wrong code uses an attempt (`invalid_code` with `attemptsRemaining`). After 5 wrong attempts the code is locked. Ask for a new one.
3. Send `Authorization: Bearer <token>` on every other call. Tokens last 24 hours by default. Store them in the platform's secure storage (Keychain or Keystore), not in local storage.
4. `POST /v1/auth/logout` revokes the token.

A `401` means the token is missing, expired, or revoked. Send the user back to step 1.

Test numbers: use only `555-0100` to `555-0199`, for example `+12025550100`.

## Tasks

| Call | What it does |
| --- | --- |
| `POST /v1/tasks` `{"goal": "..."}` | Creates a task (`201`) and starts it in a sandbox. Goal is 1 to 4000 characters |
| `GET /v1/tasks?limit=50` | The user's tasks, newest first |
| `GET /v1/tasks/:id` | One task plus its `approvals` |
| `GET /v1/tasks/:id/steps?after=0` | Steps in order |
| `GET /v1/tasks/:id/events` | Live stream of the task (see below) |
| `POST /v1/tasks/:id/stop` | Stops the task |
| `POST /v1/tasks/:id/approvals/:approvalId` `{"decision": "approve"}` or `"reject"` | Answers an approval request |
| `GET /v1/tasks/:id/files?path=` | Lists a directory of the task workspace (see below) |
| `GET /v1/tasks/:id/files/content?path=` | Downloads one workspace file |
| `GET /v1/tasks/:id/browser` | Latest browser frame metadata |
| `GET /v1/tasks/:id/browser/frame?frameId=` | One browser frame image |
| `GET /v1/me` | The user |
| `GET /v1/me/export` | All of the user's data as JSON |
| `DELETE /v1/me` | Deletes the user and all of their data (`204`) |

Another user's task returns `404`, the same as a task that does not exist.

### Task status

`queued` then `running`. It may go to `awaiting_approval` and back to `running`. It ends in `succeeded`, `failed`, or `stopped`. A finished task has `result` (text) and may have `confidence` (0 to 1).

### Steps

Each step has `seq` (1, 2, 3, and so on, with no gaps), `kind`, `title`, `detail` (JSON that depends on the kind), and `status` (`pending`, `running`, `done`, `failed`).

| kind | Meaning |
| --- | --- |
| `plan` | The plan. `detail.steps` is a list of strings |
| `tool` | The agent used a tool |
| `observation` | What it found |
| `message` | A note, for example "Approved by user" or "Stopped by user" |
| `approval_request` | The agent is waiting for the user. The matching approval is in the task's `approvals` |
| `result` | The final answer. `detail.result` and `detail.confidence` |
| `browser` | The agent used its browser. `detail.url` (may be null), `detail.action` (for example `navigate`, `click`, `screenshot`), `detail.frameId` (null when no image was captured) |

### Workspace files

Each task has a private workspace directory. It stays after the task ends and is removed when the task or user is deleted.

- `GET /v1/tasks/:id/files?path=docs` returns `{"path": "docs", "entries": [{"name", "path", "type", "size", "mtime"}], "truncated": false}`. `type` is `file`, `directory`, `symlink`, or `other`. Directories come first. Pass an entry's `path` back to open it.
- `GET /v1/tasks/:id/files/content?path=docs/notes.md` returns the bytes with a content type from the extension. HTML, SVG, XML and JavaScript come back as `text/plain`, so never render them as pages. Files over 20 MB return `413`.
- `..`, absolute paths, and symlinks that point outside the workspace are refused with `400` or `403`. A missing path is `404`.

### Browser frames

When the agent uses its browser, the task gets `browser` steps and the sandbox keeps the last 20 frames. `GET /v1/tasks/:id/browser` returns `{"latest": frame | null, "frames": [newest first]}`, where a frame is `{frameId, seq, url, action, contentType, bytes, capturedAt}`. Load the image from `GET /v1/tasks/:id/browser/frame?frameId=f3` (`image/png` or `image/jpeg`, with the bearer token). Frames that were pruned return `404`, so show the latest one. With the harness driver, only `browser_screenshot` calls produce an image; other browser actions give a step with the URL and `frameId: null`. The scripted driver adds two fake browser steps with PNG frames (goal marker `#nobrowser` turns them off).

### Approvals

When a task is `awaiting_approval`, its `approvals` list has an entry with `status: "pending"`, a `prompt` to show, and an `id`. Show the prompt with Approve and Reject buttons, then call `POST /v1/tasks/:id/approvals/:approvalId`. A second answer returns `409`. Approvals still pending when a task stops or ends become `expired`.

## Live updates (SSE)

`GET /v1/tasks/:id/events` returns `text/event-stream`:

```
event: task
data: {"id":"...","status":"running",...,"approvals":[]}

event: step
id: 3
data: {"seq":3,"kind":"observation","title":"...","detail":{...},...}

: ping

event: end
data: {"status":"succeeded"}
```

- `task` comes first, then again whenever the status or an approval changes.
- `step` carries one step. Its `id` is the step's `seq`.
- `end` comes once the task is final, and the server closes the stream. If the user deleted their data, `end` carries `{"reason": "deleted"}`.
- Lines starting with `:` are heartbeats. Ignore them.
- To resume after a dropped connection, reconnect with `?after=<last seq>` or a `Last-Event-ID` header.

The stream needs the `Authorization` header, and the browser `EventSource` cannot send headers. Read the stream with `fetch` instead:

```ts
const res = await fetch(`${base}/v1/tasks/${id}/events`, { headers: { authorization: `Bearer ${token}` } });
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let i;
  while ((i = buffer.indexOf("\n\n")) !== -1) {
    const frame = buffer.slice(0, i);
    buffer = buffer.slice(i + 2);
    const event = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    if (event && data) handle(event, JSON.parse(data));
  }
}
```

If streaming is not possible, poll `GET /v1/tasks/:id` and `GET /v1/tasks/:id/steps?after=<last seq>` every second or two.

## CORS

Allowed origins come from `ANU_CORS_ORIGINS`. The default is `capacitor://localhost,https://localhost,http://localhost:*`, which covers the Capacitor iOS and Android shells and a local dev server on any port. An entry ending in `:*` matches any port.

## Local setup

From `anu/`: `bun run db:setup`, `bun run seed`, `bun run dev`. Then sign in as `+12025550100` and read the code from `devCode`. See [`../README.md`](../README.md).
