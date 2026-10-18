# iamwillbar's Dashboard Cards

Custom cards for Home Assistant dashboards. You install them once through HACS, and each card is used by its own `type:`.

| Card | Type | What it does |
|---|---|---|
| [Pourover Card](docs/pourover-card/README.md) | `custom:pourover-card` | Guides a pourover brew pour by pour (Blue Bottle's four-pour method by default). Can use an Acaia scale for live weight. |

![Pourover Card mid-brew](docs/pourover-card/dark-pour2.png)

## Install (HACS)

1. HACS → ⋮ → **Custom repositories**.
2. Add `https://github.com/iamwillbar/ha-dashboard` with category **Dashboard**.
3. Find **iamwillbar's Dashboard Cards** and click **Download**. HACS registers `ha-dashboard.js`, which loads every card.
4. Reload the browser, then add a card by its type, e.g. `type: custom:pourover-card`.

## Layout

```
dist/ha-dashboard.js      entry file HACS registers; loads each card
dist/<card>.js            one self-contained card per file
test/<card>.test.js       node --test logic tests
dev/<card>.html           browser harness with a mock hass
docs/<card>/README.md     options, screenshots
```

## Adding a card

1. Write `dist/<card>.js`. Have it define the custom element and push itself to `window.customCards`. Guard `HTMLElement`/`customElements` so Node can import its logic.
2. Add `"<card>"` to `CARDS` in `dist/ha-dashboard.js`.
3. Add `test/<card>.test.js`, `dev/<card>.html` (link it from `dev/index.html`), and `docs/<card>/README.md`.
4. Add a row to the table above.

## Develop

- `npm test` runs every card's logic tests (Node 20+, no dependencies).
- `python3 -m http.server` serves the harnesses at `/dev/`.

## License

[MIT](LICENSE)
