process.env.SK_TEST = "1";

// Suppress stdout/stderr noise from commands during tests.
// Save originals on globalThis so captureOutput can use them.
(globalThis as any).__origConsoleLog = console.log;
(globalThis as any).__origConsoleError = console.error;
(globalThis as any).__origStdoutWrite = process.stdout.write.bind(process.stdout);

console.log = () => {};
console.error = () => {};
