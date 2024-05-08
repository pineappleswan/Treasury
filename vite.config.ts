import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import solidSvg from "vite-plugin-solid-svg";

const DEV_SERVER_PORT = 3000; // The port you connect to to use the vite server. e.g localhost:3000
const DEV_SERVER_PROXY_URL = `http://0.0.0.0:3001`; // You can change the url and its port

export default defineConfig({
  plugins: [
    solidPlugin(),
    solidSvg()
  ],
  optimizeDeps: {
    exclude: [ "@ffmpeg/ffmpeg", "@ffmpeg/util" ]
  },
  server: {
    port: DEV_SERVER_PORT,
    host: "0.0.0.0",
    proxy: {
      // Redirect API and CDN requests to node.js server (ONLY FOR DEVELOPMENT PURPOSES)
      "/api/": { target: DEV_SERVER_PROXY_URL, changeOrigin: true },
      "/cdn/": { target: DEV_SERVER_PROXY_URL, changeOrigin: true }
    }
  },
  build: {
    target: 'esnext',
  },
});
