// Vitest config — separate from vite.config.js (which loads dev-only API proxy
// plugins we don't want in tests). jsdom env for component tests; setup file
// provides matchMedia + dummy env so importing api/* modules doesn't throw.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
