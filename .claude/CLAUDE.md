# Deployment environment

## Production

This API is deployed in production on an Ubuntu virtual private server
hosted by [Infomaniak](https://www.infomaniak.com). It is publicly served at
[https://api.avventura.fun/](https://api.avventura.fun/).

## Local

`pnpm start:dev` serves the API on `http://localhost:3000`, or on `PORT` if
set (see `.env.template`). The Swagger documentation is served at the root.

| Environment | API base URL                                             |
| ----------- | -------------------------------------------------------- |
| Production  | [https://api.avventura.fun/](https://api.avventura.fun/) |
| Local       | `http://localhost:3000`                                  |

## Frontend

The API is consumed by the Avventura web app, served at
[https://avventura.fun](https://avventura.fun) from the sibling repository
`../avventura-ui` ([w3hc/avventura-v3-ui](https://github.com/w3hc/avventura-v3-ui)),
a Next.js application. It reads the API base URL from `AVVENTURA_API_URL`,
falling back to `NEXT_PUBLIC_AVVENTURA_API_URL`, and calls the API from its
route handlers under `src/app/api/`.

In local development, start the API first: port 3000 is then taken, so
`next dev` falls back to port 3001.
