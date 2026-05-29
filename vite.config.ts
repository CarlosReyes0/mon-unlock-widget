import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  if (mode === "lib") {
    return {
      plugins: [tailwindcss()],
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
  return { plugins: [tailwindcss()] };
});
