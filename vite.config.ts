import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (mode === "lib") {
    return {
      plugins: [tailwindcss()],
      define: {
        "import.meta.env.VITE_CHECKOUT_ORIGIN": JSON.stringify(
          env.VITE_CHECKOUT_ORIGIN || "https://mon-unlock-widget-production.up.railway.app"
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
      },
      build: {
        outDir: "dist-publisher",
        emptyOutDir: true,
        rollupOptions: {
          input: {
            account: resolve(__dirname, "account.html"),
            "publisher-auth": resolve(__dirname, "publisher-auth.html"),
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
          server.middlewares.use((req, _res, next) => {
            if (req.url === "/publisher-auth.js" || req.url?.startsWith("/publisher-auth.js?")) {
              req.url = "/src/publisher/auth-mount.tsx";
            } else if (
              req.url === "/publisher-auth.css" ||
              req.url?.startsWith("/publisher-auth.css?")
            ) {
              req.url = "/src/publisher/publisher-auth.css";
            }
            next();
          });
        },
      },
    ],
    define: {
      "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify(env.VITE_PRIVY_APP_ID || ""),
    },
  };
});
