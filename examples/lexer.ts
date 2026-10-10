import {
  fail,
  literal,
  notFollowedBy,
  regex,
  succeed,
  type Parser
} from "parserator"
import type { Span } from "typerator"

export const spaces = regex(/\s*/)

export const token = <T>(inner: Parser<T>): Parser<T> => spaces.zipRight(inner)

export const symbol = (text: string) => token(literal(text))

export const keyword = (word: string) =>
  token(literal(word).zipLeft(notFollowedBy(regex(/[\w']/))))

export const identifier = (keywords: readonly string[]) =>
  token(
    regex(/[a-z_][\w']*/).flatMap(word =>
      keywords.includes(word) ? fail(`${word} is a keyword`) : succeed(word)
    )
  ).expected("name")

export const located = <T>(
  inner: Parser<T>
): Parser<T & { readonly span: Span }> =>
  spaces.zipRight(inner.withSpan((node, span) => ({ ...node, span })))
