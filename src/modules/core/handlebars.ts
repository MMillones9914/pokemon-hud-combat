const HandlebarsGlobal = globalThis.Handlebars as
  { registerHelper(name: string, fn: (...args: unknown[]) => unknown): void } | undefined;

export function registerHandlebarsHelpers(): void {
  if (!HandlebarsGlobal) return;
  HandlebarsGlobal.registerHelper("phcEq", (a: unknown, b: unknown) => a === b);
  HandlebarsGlobal.registerHelper("phcGt", (a: unknown, b: unknown) => Number(a) > Number(b));
}
