export function hasErrorCode(
  error: unknown,
  code: string | number,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
