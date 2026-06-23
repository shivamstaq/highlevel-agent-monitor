import tailwindcss from '@tailwindcss/vite'

// When building for Cloudflare Pages/Workers (`NITRO_PRESET=cloudflare-pages`),
// there is no filesystem: the `data` storage namespace is backed by a Cloudflare
// KV binding instead of the local fs driver. Local `pnpm dev` / node builds are
// untouched — they keep the fs driver configured under `nitro.storage` /
// `nitro.devStorage` below.
const nitroPreset = process.env.NITRO_PRESET || ''
const isCloudflare = nitroPreset.includes('cloudflare')

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', 'shadcn-nuxt'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // Secrets stay server-side; public values are exposed to the client.
  runtimeConfig: {
    llmProvider: process.env.LLM_PROVIDER || 'ollama',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    // NOTE: model selection is per-role and lives in server/services/llm/config.ts
    // (reasoner=claude-sonnet-4-6, labeler=claude-haiku-4-5, the cost-low floor).
    // `anthropicModel` is intentionally NOT wired into that chain (it is excluded
    // by getLlmConfig so it can never override the per-role cost-low default), so
    // it carries no default here — set ANTHROPIC_MODEL only via stored settings,
    // not this key. Kept solely so an explicit override env var isn't dropped.
    anthropicModel: process.env.ANTHROPIC_MODEL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || process.env.NUXT_OPENAI_API_KEY || '',
    ghlPitToken: process.env.GHL_PIT_TOKEN || '',
    ghlApiBase: process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com',
    ghlLocationId: process.env.GHL_LOCATION_ID || '',
    ghlSharedSecret: process.env.GHL_SHARED_SECRET || '',
    // GHL webhook signature verification (PUBLIC keys — non-secret).
    // Ed25519 (current `X-GHL-Signature`) defaults to GHL's published key inside
    // server/utils/ghlWebhook.ts when this is empty; set to override on rotation.
    ghlWebhookEd25519PubKey: process.env.GHL_WEBHOOK_ED25519_PUBKEY || '',
    // RSA (legacy `X-WH-Signature`, removed 2026-07-01) — opt-in, no default.
    ghlWebhookRsaPubKey: process.env.GHL_WEBHOOK_RSA_PUBKEY || '',
    // Shared gate for the UNSIGNED GHL Workflow webhook route (?token=).
    ghlWebhookToken: process.env.GHL_WEBHOOK_TOKEN || '',
    public: {
      appName: 'Voice AI Observability Copilot'
    }
  },

  // Allow embedding inside the HighLevel dashboard iframe.
  routeRules: {
    '/**': {
      headers: {
        'Content-Security-Policy': 'frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com http://localhost:*'
      }
    },
    // Agents is the default landing page (the fleet Overview was removed).
    '/': { redirect: '/agents' }
  },

  compatibilityDate: '2025-01-15',

  // Storage for the `data` namespace (agents/calls/transcripts/analyses/flows/
  // timelines). Declared in Nitro config rather than a runtime plugin so the
  // driver is chosen at BUILD time per target — on Cloudflare there is no
  // filesystem, so it binds the `DATA` KV namespace (see wrangler.toml); on a
  // node host it uses the durable fs driver. `nuxt dev` always uses fs.
  nitro: {
    ...(isCloudflare ? { preset: nitroPreset } : {}),
    devStorage: {
      data: { driver: 'fs', base: process.env.DATA_DIR || '.data' }
    },
    storage: {
      data: isCloudflare
        ? { driver: 'cloudflareKVBinding', binding: 'DATA' }
        : { driver: 'fs', base: process.env.DATA_DIR || '.data' }
    }
  },

  vite: {
    plugins: [tailwindcss()]
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // shadcn-vue: components are copied into app/components/ui
  shadcn: {
    prefix: '',
    componentDir: '~/components/ui'
  }
})
