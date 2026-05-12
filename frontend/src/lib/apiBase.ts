// API base URL utilities

export const getApiBase = (): string => {
  const configuredBase =
    import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL;

  if (configuredBase) {
    return configuredBase;
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
  }

  return '';
};

export const getApiUrl = (path: string): string => {
  const base = getApiBase();
  return `${base}${path}`;
};
