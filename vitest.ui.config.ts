import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./client/test/setup.ts"],
        include: ["client/**/*.test.tsx", "client/**/*.test.ts"],
        alias: {
            "@": path.resolve(__dirname, "./client/src"),
            "@shared": path.resolve(__dirname, "./shared"),
            "@assets": path.resolve(__dirname, "./attached_assets"),
        },
    },
});
