import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import solidSvg from "vite-plugin-solid-svg";
// import devtools from 'solid-devtools/vite';

export default defineConfig({
  plugins: [
    /* 
    Uncomment the following line to enable solid-devtools.
    For more info see https://github.com/thetarnav/solid-devtools/tree/main/packages/extension#readme
    */
    // devtools(),
    solidPlugin(),
    solidSvg()
  ],
  server: {
    port: 3000,
    proxy: {
      /*
        -- IMPORTANT --
        1. To test the full build where every /login/treasury etc. call, goes to the node.js server, proxy should be "/".
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
