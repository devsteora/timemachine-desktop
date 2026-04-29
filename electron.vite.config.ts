// import { resolve } from 'path'
// import { defineConfig } from 'electron-vite'
// import react from '@vitejs/plugin-react'

// export default defineConfig({
//   main: {},
//   preload: {},
//   renderer: {
//     resolve: {
//       alias: {
//         '@renderer': resolve('src/renderer/src')
//       }
//     },
//     plugins: [react()]
//   }
// })


import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Bake ENTERPRISE_API_URL into the packaged app at build time.
    // Set the env var before building:
    //   Windows: $env:ENTERPRISE_API_URL="https://apitm.steorasystems.com"
    //   Linux/Mac: export ENTERPRISE_API_URL=https://apitm.steorasystems.com
    define: {
      'process.env.ENTERPRISE_API_URL': JSON.stringify(
        process.env.ENTERPRISE_API_URL || 'http://127.0.0.1:8000'
      ),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});