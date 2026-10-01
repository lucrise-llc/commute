import { describe, expect, it } from 'vitest';

import { app } from '../worker/app';

const JSON_INDENT = 2;

describe('OpenAPI document', () => {
  it('matches the committed openapi.json that the API client is generated from', async () => {
    const response = await app.request('/api/openapi.json');

    expect(response.status).toBe(200);
    const document: unknown = await response.json();
    await expect(`${JSON.stringify(document, null, JSON_INDENT)}\n`).toMatchFileSnapshot('../openapi.json');
  });
});
