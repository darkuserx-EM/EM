/** An expected input error whose message is safe to show to the user. */
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}
