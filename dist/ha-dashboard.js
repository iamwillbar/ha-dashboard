/**
 * Entry point HACS registers as the dashboard resource.
 *
 * Each card lives in its own module next to this file. They are imported
 * with this file's query string (HACS adds `?hacstag=…`), so a HACS update
 * busts the browser cache for every card, not just this entry file.
 */

export const CARDS = ["pourover-card"];

const tag = new URL(import.meta.url).search;
for (const card of CARDS) {
  import(new URL(`./${card}.js${tag}`, import.meta.url)).catch((err) =>
    console.error(`ha-dashboard: failed to load ${card}`, err),
  );
}
