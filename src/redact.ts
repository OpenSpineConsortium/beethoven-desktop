// beethoven-extension's redact rules, copied (extension/src/core/redact.ts): anything token-shaped is
// replaced before it reaches the model. Every tool result passes through one of the two functions below.
const RULES: Array<[RegExp, string]> = [
  [/(csrf=)[^&\s"']+/gi, '$1[redacted]'],
  [/ASHLEY(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/BEETHOVEN(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/\b(Bearer)\s+\S+/g, '$1 [redacted]'],
  [/\b(token|secret|password|passwd|api[_-]?key|authorization)(\s*[=:]\s*)\S+/gi, '$1$2[redacted]'],
  // a long base64url run is a token until proven otherwise; job ids, hostnames and paths are short
  [/[A-Za-z0-9_-]{40,}/g, '[redacted]'],
];

export function redact(text: string): string {
  let s = String(text ?? '');
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s;
}

// A workspace file is the student's own code and notes, where a 40-character run is as likely a commit id
// as a token, so it keeps those and loses only what has a credential's shape: an Anthropic token (the
// access and refresh tokens of a Claude sign-in both begin sk-ant-), a bearer value, a signed token, a
// "key": "value" of a credential's name, and a private key block.
const CREDENTIAL_RULES: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/ASHLEY(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/BEETHOVEN(?:REV)?1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[signed-token]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  [/("(?:accessToken|refreshToken|access_token|refresh_token|id_token|apiKey|api_key|client_secret|password)"\s*:\s*)"[^"]*"/g, '$1"[redacted]"'],
  [/\b((?:ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(?:KEY|TOKEN)\s*[=:]\s*)\S+/g, '$1[redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key redacted]'],
];

export function redactCredentials(text: string): string {
  let s = String(text ?? '');
  for (const [re, rep] of CREDENTIAL_RULES) s = s.replace(re, rep);
  return s;
}
