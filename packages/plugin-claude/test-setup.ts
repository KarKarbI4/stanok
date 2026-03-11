process.env.SK_TEST = "1";

(globalThis as any).__origConsoleLog = console.log;
(globalThis as any).__origConsoleError = console.error;
(globalThis as any).__origStdoutWrite = process.stdout.write.bind(process.stdout);

console.log = () => {};
console.error = () => {};
