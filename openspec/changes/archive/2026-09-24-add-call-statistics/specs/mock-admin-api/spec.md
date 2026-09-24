# Spec Delta

## ADDED Requirements

### Requirement: Retrieve call statistics

`GET /_mocks/stats` SHALL respond `200` with a JSON object containing a `callerHeader` field — the name of the caller-identifying header in effect — and an `entries` array of journal entries. Each entry SHALL carry `method`, `uri` (the matched mock pattern or the unmatched request path), `matched` (boolean), `caller`, `count` (integer), and `lastCalledAt` (ISO 8601 timestamp). Entries SHALL be ordered by `count` descending, ties broken by `method` ascending, then `uri` ascending, then `caller` ascending. When no calls have been recorded, `entries` SHALL be an empty array.

#### Scenario: Report reflects recorded calls

- **WHEN** one caller made two calls to a matched `GET /ping` mock, another caller made one call to an unregistered `GET /missing`, and a client sends `GET /_mocks/stats`
- **THEN** the response is `200` with `entries` ordered most-called first — the matched `GET /ping` entry with `count` `2` before the unmatched `GET /missing` entry with `count` `1` — each naming its caller and last-called timestamp, and `callerHeader` naming the configured header

#### Scenario: Empty journal

- **WHEN** no mock traffic has arrived since startup or the last reset and a client sends `GET /_mocks/stats`
- **THEN** the response is `200` with an empty `entries` array

### Requirement: Reset call statistics

`DELETE /_mocks/stats` SHALL remove every journal entry and respond `204`. Registered mocks SHALL NOT be affected. Resetting an already-empty journal SHALL succeed identically.

#### Scenario: Reset clears the journal and keeps mocks

- **WHEN** calls have been recorded, a client sends `DELETE /_mocks/stats`, and then sends `GET /_mocks/stats` and `GET /_mocks`
- **THEN** the reset responds `204`, the statistics report shows an empty `entries` array, and the mock listing is unchanged

#### Scenario: Reset on an empty journal

- **WHEN** no calls have been recorded and a client sends `DELETE /_mocks/stats`
- **THEN** the response is `204`

#### Scenario: Counting resumes after reset

- **WHEN** a journal entry shows `count` `5`, the journal is reset, and one more matching call arrives
- **THEN** the report shows that entry with `count` `1`
