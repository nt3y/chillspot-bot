# Discord Question Bot — Node.js

Converted from the original Python version.

## Setup

```bash
npm install
```

## Run

```bash
DISCORD_BOT_TOKEN=your_token node index.js
```

Or create a `.env` file and use `dotenv`:
```
DISCORD_BOT_TOKEN=your_token
```

## Commands

| Command | Description |
|---------|-------------|
| `!ask @user` | Ask a random question to a specific user |
| `!random` | Ask a random question to a random server member |

## Question repeat logic

- **First 40 questions** per server: no question repeats — each pick comes from the unused pool.
- **After 40 questions**: the restriction lifts and any question can appear randomly again.

This resets if the bot restarts (state is in-memory).

## Files needed

- `template.png` — background image
- `font_bold.ttf` — font
- `questions.json` or `questions.txt` — your questions (JSON array preferred)
- `bot_config.json` — layout config (optional, has defaults)
