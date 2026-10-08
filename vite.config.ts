import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const walletConnectProjectId =
    env.VITE_WALLETCONNECT_PROJECT_ID ||
    env.WALLETCONNECT_PROJECT_ID ||
    "c2a289e11ad2998f8ea4633db536334c";

  if (mode === "lib") {
    return {
      plugins: [tailwindcss()],
      define: {
        "import.meta.env.VITE_CHECKOUT_ORIGIN": JSON.stringify(
          env.VITE_CHECKOUT_ORIGIN || "https://openpaywall.app"
        ),
      },
      build: {
        lib: {
          entry: resolve(__dirname, "src/index.ts"),
          name: "MonUnlock",
          formats: ["es", "umd"],
          fileName: "mon-unlock",
        },
        cssCodeSplit: false,
        rollupOptions: {
          output: { assetFileNames: "mon-unlock[extname]" },
        },
      },
    };
  }

  if (mode === "checkout") {
    return {
      plugins: [react()],
      define: {
        "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify(env.VITE_PRIVY_APP_ID || ""),
        "import.meta.env.VITE_RAMP_HOST_API_KEY": JSON.stringify(env.VITE_RAMP_HOST_API_KEY || ""),
      },
      build: {
        outDir: "dist-checkout",
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(__dirname, "unlock.html"),
        },
      },
    };
  }

  if (mode === "publisher") {
    return {
      plugins: [react()],
      define: {
        "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify(env.VITE_PRIVY_APP_ID || ""),
        "import.meta.env.VITE_WALLETCONNECT_PROJECT_ID": JSON.stringify(walletConnectProjectId),
      },
      build: {
        outDir: "dist-publisher",
        emptyOutDir: true,
        rollupOptions: {
            input: {
              account: resolve(__dirname, "account.html"),
              write: resolve(__dirname, "write.html"),
              "publisher-auth": resolve(__dirname, "publisher-auth.html"),
              "follow-signin": resolve(__dirname, "src/publisher/follow-signin.tsx"),
            },
          output: {
            entryFileNames: "[name].js",
            chunkFileNames: "chunks/[name]-[hash].js",
            assetFileNames: (assetInfo) => {
              if (assetInfo.name && assetInfo.name.endsWith(".css")) {
                return "publisher-auth.css";
              }
              return "assets/[name]-[hash][extname]";
            },
          },
        },
      },
    };
  }

  return {
    plugins: [
      tailwindcss(),
      react(),
      {
        name: "publisher-auth-dev-alias",
        configureServer(server) {
          for (const key of [
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "MEDIA_DIR",
            "PUBLIC_ORIGIN",
            "BASE_BUILDER_CODE",
            "MIROSHARK_BASE_URL",
            "MIROSHARK_X402_PRIVATE_KEY",
            "VOICE_DRAFT_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "VOICE_DRAFT_PROVIDER",
            "VOICE_DRAFT_MODEL",
            "VOICE_DRAFT_BASE_URL",
          ]) {
            if (env[key] && !process.env[key]) process.env[key] = env[key];
          }
          server.middlewares.use(async (req, res, next) => {
            try {
              const { tryHandleOgRequest } = await import("./server/og-http.mjs");
              if (await tryHandleOgRequest(req, res)) return;
            } catch (e) {
              console.error("[og-dev]", e?.message || e);
            }
            try {
              const { tryHandleMirosharkRequest } = await import("./server/miroshark.mjs");
              if (await tryHandleMirosharkRequest(req, res)) return;
            } catch (e) {
              console.error("[miroshark-dev]", e?.message || e);
            }
            try {
              const { tryHandleVoiceDraftRequest } = await import("./server/voice-drafts.mjs");
              if (await tryHandleVoiceDraftRequest(req, res)) return;
            } catch (e) {
              console.error("[voice-drafts-dev]", e?.message || e);
            }
            try {
              const { tryHandleMediaRequest } = await import("./server/media-host.mjs");
              if (await tryHandleMediaRequest(req, res)) return;
            } catch (e) {
              console.error("[media-dev]", e?.message || e);
            }
            if (req.url === "/publisher-auth.js" || req.url?.startsWith("/publisher-auth.js?")) {
              req.url = "/src/publisher/auth-mount.tsx";
            } else if (req.url === "/follow-signin.js" || req.url?.startsWith("/follow-signin.js?")) {
              req.url = "/src/publisher/follow-signin.tsx";
            } else if (
              req.url === "/publisher-auth.css" ||
              req.url?.startsWith("/publisher-auth.css?")
            ) {
              req.url = "/src/publisher/publisher-auth.css";
            } else if (req.url === "/" || req.url?.startsWith("/?")) {
              req.url = "/articles.html";
            } else if (
              req.url === "/demo" ||
              req.url?.startsWith("/demo?") ||
              req.url === "/demo.html" ||
              req.url?.startsWith("/demo.html?")
            ) {
              req.url = "/index.html";
            } else if (
              req.url === "/write" ||
              req.url?.startsWith("/write?") ||
              req.url === "/write.html" ||
              req.url?.startsWith("/write.html?")
            ) {
              req.url = "/write.html";
            } else if (
              req.url === "/account" ||
              req.url?.startsWith("/account?") ||
              req.url === "/dashboard" ||
              req.url?.startsWith("/dashboard?")
            ) {
              const qIndex = req.url.indexOf("?");
              const query = qIndex >= 0 ? req.url.slice(qIndex) : "";
              req.url = req.url.startsWith("/dashboard")
                ? `/dashboard.html${query}`
                : `/account.html${query}`;
            } else if (req.url === "/articles" || req.url?.startsWith("/articles?")) {
              req.url = "/articles.html";
            } else if (req.url?.startsWith("/articles/")) {
              // Fallback if OG inject failed: keep pretty URLs working in Vite.
              const qIndex = req.url.indexOf("?");
              const pathOnly = qIndex >= 0 ? req.url.slice(0, qIndex) : req.url;
              const query = qIndex >= 0 ? req.url.slice(qIndex) : "";
              const slug = decodeURIComponent(pathOnly.slice("/articles/".length).split("/")[0] || "");
              req.url = slug
                ? `/article.html?slug=${encodeURIComponent(slug)}${query ? "&" + query.slice(1) : ""}`
                : "/articles.html";
            }
            next();
          });
        },
      },
    ],
    define: {
      "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify(env.VITE_PRIVY_APP_ID || ""),
      "import.meta.env.VITE_WALLETCONNECT_PROJECT_ID": JSON.stringify(walletConnectProjectId),
    },
  };
});
