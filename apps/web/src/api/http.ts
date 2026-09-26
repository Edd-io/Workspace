export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields of the error response (e.g. the path of a worktree with uncommitted changes). */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (data ?? {}) as { error?: string; message?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error.error ?? 'unknown_error', error.message, error);
  }
  return data as T;
}
