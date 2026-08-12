// Mask secret-bearing query params before strings hit the logs.
//
// Prowlarr download-proxy URLs and some indexer error messages embed
// credentials as query params (?apikey=..., &passkey=..., &token=...).
// 0.34.0: Easynews uses URL-embedded HTTP Basic Auth (user:pass@host) for
// playback streams, so we also scrub that pattern.
//
// Those URLs/errors get logged during stream resolution, so scrub them to
// avoid leaking creds into container logs that may be shipped elsewhere.

const SECRET_PARAM = /([?&](?:api[_-]?key|api[_-]?token|access[_-]?token|token|passkey|apikey|secret|pass)=)([^&\s'"]+)/gi;

// Matches URL-embedded basic auth: https://user:pass@host/...
// Captures the scheme so we keep the URL recognizable in logs.
const URL_BASIC_AUTH = /\b(https?:\/\/)[^:/\s'"@]+:[^@\s'"]+@/gi;

function redact(input) {
  if (input == null) return input;
  return String(input)
    .replace(SECRET_PARAM, (m, p1) => p1 + '***')
    .replace(URL_BASIC_AUTH, (m, scheme) => scheme + '***:***@');
}

module.exports = { redact };
