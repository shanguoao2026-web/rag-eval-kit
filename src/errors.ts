/** User-facing failure. `exitCode` 2 is bad input or transport; 1 is reserved for scored failures. */
export class EvalError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "EvalError";
    this.exitCode = exitCode;
  }
}
