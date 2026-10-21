import type { AppError } from "./bindings";

export * from "./bindings";

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Thrown by {@link unwrap} so query/mutation error handlers get the AppError. */
export class CommandError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.detail ?? appError.kind);
    this.name = "CommandError";
  }
}

/** Converts a tauri-specta result into a value, throwing on error. */
export async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const r = await result;
  if (r.status === "error") throw new CommandError(r.error);
  return r.data;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof CommandError) return error.appError;
  return {
    kind: "unknown",
    params: {},
    detail: error instanceof Error ? error.message : String(error),
  };
}
