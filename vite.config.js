import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from "vite-plugin-solid-svg";
// import devtools from 'solid-devtools/vite';

export default defineConfig({
  plugins: [
    solidPlugin(),
    solidSvg()
  ],
  server: {
    port: 3000,
    proxy: {
      /*
        -- IMPORTANT --
        1. To test the full build where every /login /treasury etc. call, goes to the node.js server, proxy should be "/".
           This replicates the normal behaviour of the website in production.
           However, in this mode, you may need to run "npm run build" to ensure everything works.

        2. If customising the looks of the website, proxy only "/api/" so API calls only go to the node.js server and hot module replacement works.
      */
      
      "/api/": { // Redirect API calls to node.js server (ONLY FOR DEVELOPMENT PURPOSES)
        target: "http://localhost:3001",
        changeOrigin: true,
      }
    }
  },
  build: {
    target: 'esnext',
  },
});

/*
//rejectUnauthorized: false,
//secure: false,
configure: (proxy, _options) => {
  proxy.on('error', (err, _req, _res) => {
    console.log('proxy error', err);
  });
  proxy.on('proxyReq', (proxyReq, req, _res) => {
    console.log('Sending Request to the Target:', req.method, req.url);
  });
  proxy.on('proxyRes', (proxyRes, req, _res) => {
    console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
  });
},
*/