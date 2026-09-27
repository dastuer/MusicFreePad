import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(
    readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

export default defineConfig({
    root: __dirname,
    plugins: [react()],
    base: "./",
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    server: {
        port: 5174,
        strictPort: true,
        // iPad 通过局域网访问开发机时调试用
        host: true,
    },
    build: {
        outDir: "dist",
        chunkSizeWarningLimit: 3000,
    },
});
