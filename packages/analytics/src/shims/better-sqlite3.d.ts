declare module "better-sqlite3" {
  export default class Database {
    constructor(filename?: string, options?: { readonly?: boolean });
    pragma(sql: string): void;
    exec(sql: string): void;
    prepare<TParams extends Record<string, any> = any, TRow = any>(sql: string): Statement<TParams, TRow>;
    transaction<TArgs extends any[] = any[]>(fn: (...args: TArgs) => any): (...args: TArgs) => void;
    close(): void;
  }

  export interface Statement<TParams extends Record<string, any> = any, TRow = any> {
    run(params?: TParams): { changes: number; lastInsertRowid: number | bigint };
    get(params?: TParams): TRow | undefined;
    all(params?: TParams): TRow[];
  }
}
