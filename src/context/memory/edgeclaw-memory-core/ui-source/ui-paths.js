export function createMemoryApiUrl(dashboardPathname, requestPath) {
  const marker = "/memory-dashboard";
  const markerIndex = String(dashboardPathname || "").indexOf(marker);
  const appBase = markerIndex >= 0 ? dashboardPathname.slice(0, markerIndex) : "";
  const suffix = String(requestPath || "").startsWith("/") ? requestPath : `/${requestPath}`;
  return `${appBase}${suffix}`;
}
