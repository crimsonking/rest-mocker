# Tasks

## 1. bodySchema enforcement over HTTP

- [x] 1.1 In `scripts/smoke.mjs` (after the existing registration section, reusing its `req`/`eq`/`register` helpers): register `POST /sm-orders` with status `201`, body `{"ok":true}`, and a `bodySchema` requiring string `name`; assert bad body `{"name":42}` → `400` with `error.details[0].field === '/name'`, absent body → `400`, good body → `201` `{"ok":true}`; verify by running the suite
- [x] 1.2 Capture the `GET /_mocks` list length before the rejections and assert it is unchanged after (nothing registered by failed calls); run the suite

## 2. responseSchema generation over HTTP

- [x] 2.1 Register `GET /sm-gen` with a `responseSchema` (object, required integer `id` + string `name`); call twice and assert: both `200` with `content-type: application/json`, `Number.isInteger(id)` and `typeof name === 'string'` on both, and the two raw body strings differ; run the suite

## 3. Registration rejections

- [x] 3.1 Assert `POST /_mocks` with `bodySchema: {"type":"nope"}` → `400` with details naming `bodySchema`; with `responseSchema: {"type":"nope"}` → `400` naming `responseSchema`; with both `body` and `responseSchema` → `400` message matching `/cannot be combined/`; list length unchanged after all three; run the suite

## 4. Full gate

- [x] 4.1 `npm run build`; start the production server with a temp `MOCK_DB_FILE` and free port; `MOCK_BASE=<url> npm run smoke` exits 0 with all checks passed (previous 46 plus the new ones); stop the server
