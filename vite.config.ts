import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base: the build works from any static host or sub-folder.
  base: './',
  build: {
    target: 'es2022',
    // public/assets holds models; keep bundled code in its own folder.
    assetsDir: 'static',
    chunkSizeWarningLimit: 600,
    // three.js gets its own long-cached chunk, loaded after first paint.
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
})
