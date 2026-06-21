import tailwindcss from '@tailwindcss/vite'

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
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    ghlPitToken: process.env.GHL_PIT_TOKEN || '',
    ghlApiBase: process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com',
    ghlSharedSecret: process.env.GHL_SHARED_SECRET || '',
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
    }
  },

  compatibilityDate: '2025-01-15',

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
