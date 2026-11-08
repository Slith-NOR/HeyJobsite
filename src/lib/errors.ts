/** Expected, user-facing failure. `code` maps to a translated message. */
export class DomainError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
  }
}

export class NotAuthorized extends DomainError {
  constructor() {
    super("not_authorized", "Not authorized");
  }
}

/** True when a Postgres unique-constraint violation (23505) is anywhere in the error chain. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
