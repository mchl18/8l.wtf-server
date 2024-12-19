# 8l.wtf server

![Uptime](https://status.mgerullis.com/api/badge/1/uptime?style=flat-square)

A URL shortening service built with Express and TypeScript. This service allows you to:

- Create shortened URLs with optional expiration times
- Generate QR codes for URLs
- Support for authenticated and anonymous URL shortening
- Delete proxy functionality

## Features

- URL shortening with customizable short IDs
- Optional URL expiration
- QR code generation
- Support for authenticated URLs with encrypted seeds
- Delete proxy functionality
- Health check endpoint

## API Endpoints

### POST /api/shorten
Creates a shortened URL. Accepts:
- `url`: The URL to shorten
- `maxAge`: Optional expiration time in milliseconds
- `seed`: Optional encrypted seed for authenticated URLs

### POST /api/qr
Generates a QR code. Accepts:
- `text`: The text/URL to encode
- `options`: Optional QR code configuration

### POST /api/delete-proxy
Proxies delete requests to URLs. Accepts:
- `id`: The short URL ID

### GET /health
Health check endpoint

## Development

1. Clone the repository
2. Install dependencies with `yarn install`
3. Create a `.env` file with required environment variables
4. Run `yarn dev` to start in development mode

## Environment Variables

- `ID_LENGTH`: Length of generated short IDs (default: 8)
- `PORT`: Server port (default: 3003)

## Tech Stack

- Express.js
- TypeScript
- Redis for data storage
- QRCode for QR generation
- Various security middleware (helmet, cors, etc)

## TODO

- [ ] add challenges instead of seed checking
- [ ] fix delete proxy
- [ ] more input validation
- [ ] add more tests
- [ ] add more logging
- [ ] add more metrics
- [ ] add more error handling
- [ ] add more documentation