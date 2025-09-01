## Shitpost Clan Points Bot

Was created out of spite. A point bot is very piss easy to make.

### Running

```yml
services:
  app:
    image: .
    restart: unless-stopped
    env:
      BOT_TOKEN: 
      CLIENT_ID: # For registering commands only.
    volumes:
      - ./data:/app/data
```