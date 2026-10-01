type LogRecord = Record<string, unknown> & {
  event: string;
};

// Workers Logs indexes the fields of an object passed to console, so each record is one object.
export function log(record: LogRecord): void {
  console.log(record);
}

export function logError(record: LogRecord & { error: unknown }): void {
  const { error, ...fields } = record;
  console.error({ ...fields, error: error instanceof Error ? error.message : String(error) });
}
