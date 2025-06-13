# PSX-Connect

PSX-Connect is a FIX protocol-based client designed to connect to the Pakistan Stock Exchange (PSX) for real-time market data and trading information.

---

## How This Project Works

1. The client establishes a connection with the PSX server using the host and port specified in the `.env` file.
2. After the connection is established, a **Logon** message is sent to initiate the FIX session.
3. Once logged in, market data is received via the **FIX protocol**, distributed across multiple channels.
4. Each FIX message corresponds to a specific channel and contains relevant market data.
5. All incoming FIX messages are:
   - Stored in **Redis** for caching and persistence.
   - Emitted to the frontend in real-time using **WebSockets**.

---

## Project Structure

- `src/`
  - `index.ts` - Main entry point, Express API, and server setup
  - `fix/` - FIX client logic and message handling
  - `utils/` - Utility functions (logging, message formatting, helpers, etc.)
  - `types/` - TypeScript types and interfaces
- `.env` - Environment variables for configuration
- `README.md` - Project documentation

---

## Setup & Build

Run the following steps in your local development environment:

```bash
npm install
npm run build
npm start
```

To commit and push changes:
```bash
git add .
git commit -m "your commit message"
git push origin your-branch-name
```

---

## Deployment 

Run the following steps on your server side:

```bash
ssh t1
su - nodefix
# Enter password when prompted
cd psx-connect
# For the latest code from your branch
git pull
npm start
```

---

## Redis Operations

Check Market Data for a Specific Channel

```bash
redis-cli HGETALL "fix-latest:<channelNo>"
# Example:
redis-cli HGETALL "fix-latest:1"
```

View All Redis Keys

```bash
redis-cli KEYS '*'
```

Remove all keys and data from redis

```bash
redis-cli FLUSHALL
```

---

## Test Socket

```bash
ngrok http http://localhost:8080
# after run the above on the server then copy the Forwarding like: https://01e4-110-39-2-178.ngrok-free.app

https://01e4-110-39-2-178.ngrok-free.app
# Add this to frontend and connect with this when conenction build frontend will receive the fix messages
```

---


## Test API

```bash
ngrok http http://localhost:3000
# after run the above on the server then copy the Forwarding like: https://01e4-110-39-2-178.ngrok-free.app

# test api on postman (method GET) and this will provide data which is stored in redis
https://01e4-110-39-2-178.ngrok-free.app/api/latest-data/1
```

---

## How to Extend Message Formatting

- To customize which fields/tags are sent to the frontend, edit `src/utils/messages-formatter.ts`.
- You can add channel-specific formatting logic for future requirements.
- Example: To only send certain tags for a channel, filter the message keys accordingly.

---

## Adding New API Endpoints

- Add new routes in `src/index.ts` using Express.
- Use async/await for Redis or other async operations.
- Validate input and handle errors gracefully.

---

## Running & Testing Locally

- Ensure Redis is running locally (`redis-server`)
- Start the backend: `npm start`
- Use Postman or curl to test API endpoints
- Use `ngrok` for public API testing if needed

---

## Reconnection and Logout Handling

- The FIX client automatically attempts to reconnect if the connection to the PSX server is lost.
- On disconnection, all connected WebSocket clients are notified with a `psx_disconnected` message.
- On successful reconnection, the FIX session is re-established and data flow resumes.
- Logout messages from the server are handled gracefully, and the client will attempt to reconnect unless explicitly shut down.
- You can find and customize this logic in `src/fix/index.ts` and `src/index.ts` (look for event handlers like `on('disconnected')`, `on('logon')`, and `on('error')`).
- For custom reconnection strategies or to change the logout behavior, edit the relevant event handlers in these files.

---

## Frontend Handling of Disconnection

- When the frontend receives a `psx_disconnected` message from the backend (via WebSocket), it should immediately call the API (e.g., `/api/latest-data/:channelNo`) to fetch the latest data stored in Redis.
- This ensures users still see the most recent available data, even if the live connection to PSX is lost, and prevents showing a blank page or only a disconnect message.
- The frontend should display the cached data and optionally show a warning or indicator that the data is not live.

---

## Troubleshooting

- **Redis connection errors:** Ensure Redis is running and accessible.
- **Port conflicts:** Change the port in `.env` or `src/index.ts` if needed.
- **FIX connection issues:** Check PSX server credentials and network access.
- **TypeScript errors:** Run `npm run build` to see type errors and fix them.

---

## Notes
- Ensure Redis and Node.js services are running on the server.
- channelNo should always be a valid integer when querying Redis.
- Remember to update .env or config files if new environments are introduced.
- For any new features, add documentation and code comments to help future developers.

---

## MySQL Integration for Batch Storage

- The backend connects to a MySQL database (`pkfinancedb`) and stores FIX messages in batches of 500 every 10 minutes.
- Table: `fix_messages`
- Fields: `symbol`, `channel_no`, `message`, `updated_at`, `last_seen_at`, `deleted_at`, `created_at`
- Sequelize is used for ORM, migrations, and controller logic.
- See `src/models/FixMessage.ts` for the model definition.
- See `src/controllers/fixMessageController.ts` for controller logic (batch insert, etc).
- Migration file: `src/migrations/xxxx-create-fix_messages.js` (see below for example).

---

- A scheduled job (e.g., using node-cron) should run every 10 minutes to fetch 500 entries from Redis, save to MySQL, and remove them from Redis.
- See Sequelize and node-cron documentation for more details.