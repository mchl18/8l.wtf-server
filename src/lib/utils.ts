export const getProtocol = (hostname = '') => {
  return hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1') ? 'http' : 'https';
};

export const getHostUrl = () => {
  let hostname =
    process.env.NEXT_PUBLIC_HOSTNAME ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL;
  const protocol = getProtocol(hostname);
  return `${protocol}://${hostname}`;
};
