/**
 * Sample TypeScript fixture.
 */
export interface Options {
  readonly name?: string | null;
  retries: number;
}

const DEFAULTS: Options = { name: null, retries: 3 };

export async function greet(opts: Partial<Options> = {}): Promise<string> {
  const { name, retries } = { ...DEFAULTS, ...opts };
  const label = name ?? "world";
  const squares = [1, 2, 3].map((n) => n ** 2).filter((n) => n !== 4);

  for (let i = 0; i < retries; i++) {
    // Template literal with an expression inside.
    console.log(`attempt ${i + 1}: ${label} -> ${squares.join(", ")}`);
  }
  return `Hello, ${label}!`;
}
