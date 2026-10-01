export type ServerConfig = {
  url: string;
  projectId: string;
};

export function serverFromEnv(): ServerConfig {
  const url = process.env['COMMUTE_URL'];
  const projectId = process.env['COMMUTE_PROJECT'];
  if (url === undefined || url === '' || projectId === undefined || projectId === '') {
    throw new Error('Set COMMUTE_URL to the Commute server and COMMUTE_PROJECT to the project ID.');
  }
  return { url, projectId };
}

export function describeApiError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'error' in error && typeof error.error === 'string') {
    return error.error;
  }
  return JSON.stringify(error);
}
