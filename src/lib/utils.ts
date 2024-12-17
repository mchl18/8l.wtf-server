export const getProtocol = (hostname = '') => {
  return hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1') ? 'http' : 'https';
};

export const getHostUrl = () => {
  let hostname =
    process.env.NEXT_PUBLIC_HOSTNAME ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL;
  // if (typeof window === "undefined") {
  //   const protocol = getProtocol(hostname);
  //   return `${protocol}://${hostname}`;
  // }
  // if (!hostname) {
  //   console.log("No NEXT_PUBLIC_HOSTNAME found, using window.location.origin");
  //   hostname = window.location.hostname;
  // }
  const protocol = getProtocol(hostname);
  return `${protocol}://${hostname}`;
};

export const generateToken = () => {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const token = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return token;
};

export const isValidToken = (token: unknown): boolean => {
  // Check if token is a string
  if (typeof token !== 'string') {
    return false;
  }

  // Check length (64 characters for 32 bytes in hex)
  if (token.length !== 64) {
    return false;
  }

  // Check if string only contains valid hexadecimal characters
  const hexRegex = /^[0-9a-f]+$/;
  return hexRegex.test(token);
};


export const cleanUrl = (url: string) => {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^http:\/\//, '')
    .replace(/\/$/, '');
};

export const validateEncryptedSeedFormat = (encryptedSeed: string) => {
  // Check if the string matches the pattern: 32 hex chars : 32 hex chars
  const pattern = /^[0-9a-f]{32}:[0-9a-f]{32}$/i;
  // Test if the encrypted seed matches the pattern
  return pattern.test(encryptedSeed);
};
