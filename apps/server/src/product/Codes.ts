import { createHash, randomBytes } from "node:crypto"

/** No 0/O, 1/I/L: codes get read aloud and typed on Chromebooks. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export const shortCode = (length = 6): string => {
  const bytes = randomBytes(length)
  let out = ""
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Normalises what a student typed: case, spaces and dashes ("ab3-k9x" -> "AB3K9X"). */
export const normaliseCode = (input: string): string => input.toUpperCase().replace(/[\s-]/g, "")

/** 128-bit capability secret for links and tokens (D-04). */
export const newSecret = (): string => randomBytes(16).toString("base64url")

/** Only hashes of secrets are stored. */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")
