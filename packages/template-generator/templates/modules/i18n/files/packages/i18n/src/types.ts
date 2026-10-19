import type source from "./messages/en";

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Message tree shape; `en` is the source of truth for keys. */
export type Messages = Widen<typeof source>;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Dot-separated path to a message, e.g. `core.nav.home`. */
export type MessageKey = Leaves<Messages>;

export type MessageParams = Record<string, string | number>;
