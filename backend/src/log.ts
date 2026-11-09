/** Structured JSON logs. Every payment event logs its Kora reference so it can be traced end to end. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(evt: string, fields?: LogFields): void;
  warn(evt: string, fields?: LogFields): void;
  error(evt: string, fields?: LogFields): void;
}

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function createLogger(base: LogFields = {}): Logger {
  const emit = (level: string, evt: string, fields?: LogFields) => {
    const line = JSON.stringify({ level, evt, ...base, ...fields }, replacer);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    info: (evt, f) => emit('info', evt, f),
    warn: (evt, f) => emit('warn', evt, f),
    error: (evt, f) => emit('error', evt, f),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
