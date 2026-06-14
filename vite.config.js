import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from a GitHub Pages project subpath
// (e.g. https://user.github.io/recipe_book/) without extra config.
export default defineConfig({
  base: './',
  plugins: [react()],
})
