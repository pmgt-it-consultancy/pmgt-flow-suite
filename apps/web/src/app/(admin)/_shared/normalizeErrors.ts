/**
 * Normalizes TanStack Form validation errors into the shape expected by shadcn's FieldError component.
 * TanStack Form may return errors as plain strings or objects; FieldError expects { message?: string }.
 */
export function normalizeErrors(errors: unknown[]): Array<{ message?: string } | undefined> {
  return errors.map((e) => {
    if (typeof e === "string") return { message: e };
    if (e && typeof e === "object" && "message" in e) return e as { message?: string };
    return undefined;
  });
}
