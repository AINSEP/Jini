/** @file The consent refusal a publish returns: consent builds it when its checks fail, publish paths return it as is. */
export type ConsentProblem = { code: string; message: string; field?: string };
