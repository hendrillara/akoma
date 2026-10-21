// The norm registry: every norm Akoma builds, in dataset order. Adding a norm = one manifest here plus its tests
// (docs/adding-a-norm.md).
import type { NormManifest } from "../pipeline/build.ts";
import { adct } from "./adct.ts";
import { cdc } from "./cdc.ts";
import { cf } from "./cf.ts";

export const norms: NormManifest[] = [cf, adct, cdc];
