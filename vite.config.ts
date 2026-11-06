import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  optimizeDeps: {
    // Prebundle the complete browser graph before fixture/deep-link navigation;
    // late React discovery can reload a page with two module identities.
    include: [
      "zod",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@auth0/auth0-react",
      "@supabase/supabase-js",
      "lucide-react",
      "@js-temporal/polyfill",
    ],
  },

  plugins: [react(), tailwind()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("@auth0")) return "auth0";
        },
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,

    proxy: {
      "/api": process.env.WALLETWISE_API_TARGET || "http://127.0.0.1:3001",
    },
  },
});
