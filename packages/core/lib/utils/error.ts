export class WbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "WbError";
  }
}
