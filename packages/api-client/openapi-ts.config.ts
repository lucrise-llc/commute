import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../apps/server/openapi.json',
  output: {
    path: 'src/generated',
    module: {
      extension: '.ts'
    }
  },
  plugins: [
    '@hey-api/typescript',
    'zod',
    { name: '@hey-api/sdk', validator: { response: 'zod' } },
    { name: '@hey-api/client-fetch', baseUrl: false }
  ]
});
