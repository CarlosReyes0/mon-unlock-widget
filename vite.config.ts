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

  return {
    plugins: [tailwindcss(), react()],
  };
});
