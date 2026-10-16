// Extends app.json. EXPO_PUBLIC_BASE_URL serves the web build from a sub-path, e.g. "/ecomove" for
// GitHub Pages at https://<user>.github.io/ecomove/. Leave it unset for a domain root (Cloudflare, local dev).
module.exports = ({ config }) => {
  const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return {
    ...config,
    experiments: { ...config.experiments, ...(base ? { baseUrl: base } : {}) },
  };
};
