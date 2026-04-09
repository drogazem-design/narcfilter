// Shared env var guard. Call at module load time before any SDK is instantiated.
// Throws immediately with a clear message if any required variable is missing or empty.

export function checkEnv(...varNames) {
  const missing = varNames.filter(name => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env var: ${missing.join(', ')}`);
  }
}
