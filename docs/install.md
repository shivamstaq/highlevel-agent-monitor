# Installing the Voice AI Observability Copilot in a HighLevel sandbox

End-to-end steps to run this app against a real GoHighLevel (HighLevel) sandbox
sub-account and embed it as a Custom Page. If you only want to evaluate locally,
you can skip this entirely — run `pnpm dev`, click **Load demo data**, and the
seeded transcripts drive the full loop. This guide is for wiring up live
ingestion and the in-app iframe embed.

> **Prerequisites:** Node 20+, `pnpm`, and either a running Ollama
> (`ollama pull qwen2.5:14b`) or `LLM_PROVIDER=mock` / an Anthropic key. A
> HighLevel **agency** account with Marketplace access to create sandboxes.

---

## 1. Create a sandbox sub-account

1. Sign in to the [HighLevel Marketplace](https://marketplace.gohighlevel.com/)
   with your agency account.
2. Open **Settings → Sandbox** (or **My Apps → Sandbox**) and create a **sandbox
   sub-account**. This gives you a throwaway location with test data and access to
   Voice AI features without touching a production client.
3. Inside the sandbox sub-account, enable **Voice AI** and confirm at least one
   Voice AI agent exists with a few completed calls. Note the sub-account's
   **Location ID** (Settings → Business Profile, or the `location.id` shown in the
   URL) — you'll need it for the embed.

---

## 2. Generate a Private Integration Token (PIT)

The app authenticates to the GHL REST API with a Private Integration Token rather
than a full OAuth marketplace app.

1. In the **sandbox sub-account**, go to **Settings → Private Integrations**.
2. Click **Create new integration**. Name it e.g. `voice-ai-observability`.
3. Grant these scopes (read-only is sufficient):
   - `voice-ai-dashboard.readonly` — read Voice AI call logs / transcripts.
   - **Agents read** (`agents.readonly`, if listed) — read agent goal/script config.
4. Create the token and **copy it** — it is shown once. This is your
   `GHL_PIT_TOKEN`.

---

## 3. Configure environment variables

Copy the example file and fill it in:

```bash
cp .env.example .env
```

Set at least:

```dotenv
# Analysis engine — pick one
LLM_PROVIDER=ollama            # or: mock | anthropic
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
# ANTHROPIC_API_KEY=sk-ant-... # only if LLM_PROVIDER=anthropic

# HighLevel
GHL_PIT_TOKEN=<the token from step 2>
GHL_API_BASE=https://services.leadconnectorhq.com
GHL_SHARED_SECRET=<choose/copy the Custom Page shared secret, see step 5>
```

Every key here maps to a `runtimeConfig` value in `nuxt.config.ts`. See
[`.env.example`](../.env.example) for the full annotated list.

---

## 4. Deploy the app over HTTPS

HighLevel embeds the app in an `<iframe>`, so it **must be served over HTTPS** at a
stable URL.

1. Build and run, or deploy to any Node host (Vercel, Fly, Render, a VPS, etc.):

   ```bash
   pnpm install
   pnpm build
   node .output/server/index.mjs      # serves the Nitro output
   ```

2. Put it behind HTTPS. For local sandbox testing you can tunnel:

   ```bash
   pnpm dev                            # http://localhost:3000
   # in another shell, expose it:
   npx ngrok http 3000                 # -> https://<something>.ngrok-free.app
   ```

3. Note your public origin, e.g. `https://your-app.example.com` (referred to below
   as `https://<app>`). The CSP `frame-ancestors` directive in `nuxt.config.ts`
   already allows `*.gohighlevel.com` and `*.leadconnectorhq.com` to frame the app.

---

## 5. Add a Custom Page / Menu Link in the sandbox

This is what makes the dashboard appear *inside* HighLevel.

1. In the sandbox sub-account go to **Settings → Custom Menu Links** (or
   **Sites → Custom Pages**, depending on the menu).
2. Add a new link/page:
   - **Name:** `Voice AI Observability`
   - **URL:**
     ```
     https://<app>/?locationId={{location.id}}
     ```
     HighLevel substitutes `{{location.id}}` with the current sub-account's
     Location ID at render time, so the app knows which location it's embedded in.
   - **Open in:** iframe / embedded (not a new tab).
3. If the Custom Page exposes a **shared secret** for signed user-context, copy it
   into `GHL_SHARED_SECRET` (step 3). The app's `GET /api/context` AES-decrypts the
   signed payload HighLevel posts into the iframe to recover the location/user
   identity; `app/composables/useGhlBridge.ts` performs the `postMessage`
   handshake.
4. Open the menu item from inside the sandbox — the dashboard should render embedded
   in HighLevel, scoped to that location.

---

## 6. (Optional) Register the Voice AI webhook

For real-time ingestion instead of on-demand polling:

1. In the sandbox, configure a **Voice AI webhook** (Settings → Webhooks, or the
   Voice AI agent's automation settings) for `call-completed` /
   `transcript-generated` events.
2. Point it at:
   ```
   https://<app>/api/webhooks/ghl
   ```
3. The endpoint upserts the incoming call + transcript and triggers analysis
   automatically. New calls then appear in the dashboard without a manual sync.

---

## 7. Ingest and verify

You now have two ways to pull live calls; either populates the dashboard:

- **On-demand poll** — trigger a sync (e.g. from the app's sync control, or
  directly):

  ```bash
  curl -X POST https://<app>/api/sync
  # -> { "ingested": <n> }
  ```

  This calls GHL `/voice-ai/dashboard/call-logs` with your PIT and ingests new
  calls + transcripts.

- **Webhook** — make a test call in the sandbox (or wait for one) and let the
  `call-completed` event hit `/api/webhooks/ghl`.

Then:

1. Open the embedded dashboard. Synced calls appear in the agent table and call
   list.
2. Open a call to see its analysis — scorecard, findings cited to transcript turns,
   recommendations, and highlighted Use-Action segments.
3. Use **Re-analyze** to re-run the engine on a call (idempotent via transcript
   hash; pass `force` to override the cache).

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| App won't render inside HighLevel | The embed URL must be **HTTPS**; confirm the origin is allowed by the `frame-ancestors` CSP in `nuxt.config.ts`. |
| `/api/sync` returns 0 or errors | Check `GHL_PIT_TOKEN` and that the PIT has `voice-ai-dashboard.readonly`; confirm `GHL_API_BASE`. |
| Context decode fails | `GHL_SHARED_SECRET` must match the Custom Page secret exactly. |
| Analysis never completes | Ensure Ollama is running with `qwen2.5:14b` pulled, or set `LLM_PROVIDER=mock` for a model-free run. |
| Empty dashboard, no sandbox yet | Run `pnpm dev` and click **Load demo data** to seed agents + transcripts locally. |
