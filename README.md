# Raspberry instock check bot

Get an alert on Telegram when there are Raspberry in stock ready to buy. This bot uses [rpilocator](https://rpilocator.com/) to check for stock updates.

Join the public Telegram channel to get notifications! [@raspberry_alert](https://t.me/raspberry_alert/35)

We also mirror the content of the [rpilocator](https://rpilocator.com/) website on this public API endpoint: [raspberry.rigwild.dev](https://raspberry.rigwild.dev)

🌟 Star the project if we helped you get a Raspberry! 🙏

## Features

- Send an alert when a new Raspberry is in stock

![screenshot](./screenshot.png)

- Live update a message with currently in stock Raspberry

![screenshot live update](./screenshot-live.png)

- API showing current rpilocator stock

## Install

```sh
pnpm i
```

## Build

```sh
pnpm build
```

## Run

```sh
TELEGRAM_TOKEN=<telegram_bot_token> \
TELEGRAM_ADMIN_CHAT_ID=<telegram_chat_id_where_to_send_debug_info> \
TELEGRAM_CHAT_ID=<telegram_chat_id_where_to_send_alerts> \
TELEGRAM_CURRENTLY_IN_STOCK_MESSAGE_ID=<telegram_message_id_to_live_update_current_stock> \
USE_DIRECT_PRODUCT_LINK=1 \
SEARCHED_RASPBERRY_MODELS=RPI4-MODBP-4GB,RPI4-MODBP-8GB \
PROXY=http://user:pass@123.123.123.123:51234 \
CHECK_INTERVAL=30000 \
pnpm start
```

| Environment variable                     | Required | Description                                                                                        |
| ---------------------------------------- | :------: | -------------------------------------------------------------------------------------------------- |
| `TELEGRAM_TOKEN`                         |    ✅    | Telegram bot token                                                                                 |
| `TELEGRAM_ADMIN_CHAT_ID`                 |    ✅    | Telegram chat id where to send error messages (can be the same as `TELEGRAM_CHAT_ID`)              |
| `TELEGRAM_CHAT_ID`                       |    ✅    | Telegram chat id where to send stock alerts and update the live stock update message               |
| `TELEGRAM_CURRENTLY_IN_STOCK_MESSAGE_ID` |          | Telegram message id to update with the current stock                                               |
| `USE_DIRECT_PRODUCT_LINK`                |          | Should the products links be direct product links? (if `0`, will send rpilocator link)             |
| `USE_CACHED_REQUEST`                     |          | Load data from file system instead of sending requests (use if you have one other checker running) |
| `SEARCHED_RASPBERRY_MODELS`              |          | List of Raspberry models to look for, separated by a `,`. If omitted, will look for all models     |
| `PROXY`                                  |          | Proxy to use to fetch data from rpilocator                                                         |
| `CHECK_INTERVAL`                         |          | Check interval in ms, checking too often might get you rate-limited (default is `60000`)           |
| `API_RUN`                                |          | Start the API server                                                                               |
| `API_PORT`                               |          | API server port                                                                                    |
| `API_TRUST_PROXY`                        |          | Enable if server is ran behind a reverse proxy, for the rate limit                                 |

To get the `TELEGRAM_CURRENTLY_IN_STOCK_MESSAGE_ID`:

- Right click on the message you want to be updated (message must be in the `TELEGRAM_CHAT_ID` channel)
- Copy message link
- Take the number at the end

To get a Telegram chat id:

- Use [@RawDataBot](https://stackoverflow.com/a/46247058)
- If it's a public channel, use the public @: `TELEGRAM_CHAT_ID='@raspberry_alert'`

## Run with auto-restart

Use [PM2](https://pm2.keymetrics.io/)

```sh
pnpm build
TELEGRAM_TOKEN=<telegram_bot_token> <other variables> pm2 start dist/index.js
```

See logs

```sh
pm2 logs
```

Kill

```sh
pm2 delete all
```

## Run with Docker

Use [Docker](https://docker.com)

```sh
docker build -t raspberry-instock-check .
docker run -d -e TELEGRAM_TOKEN='...' -e TELEGRAM_CHAT_ID='...' -e TELEGRAM_ADMIN_CHAT_ID='...' raspberry-instock-check
```

## Test

To simulate some alerts to see if it's working, set the environment variable `NODE_ENV=test`.

## List of Raspberry models

| Model (SKU)      | Description                            |
| ---------------- | -------------------------------------- |
| `CM3-Lite`       | RPi CM3 - 1GB RAM, No MMC              |
| `CM3+16GB`       | RPi CM3+ - 1GB RAM, 16GB MMC           |
| `CM3+32GB`       | RPi CM3+ - 1GB RAM, 32GB MMC           |
| `CM3+8GB`        | RPi CM3+ - 1GB RAM, 8GB MMC            |
| `CM3+Lite`       | RPi CM3+ - 1GB RAM, No MMC             |
| `CM4001000`      | RPi CM4 - 1GB RAM, No MMC, No Wifi     |
| `CM4001008`      | RPi CM4 - 1GB RAM, 8GB MMC, No Wifi    |
| `CM4001016`      | RPi CM4 - 1GB RAM, 16GB MMC, No Wifi   |
| `CM4001032`      | RPi CM4 - 1GB RAM, 32GB MMC, No Wifi   |
| `CM4002000`      | RPi CM4 - 2GB RAM, No MMC, No Wifi     |
| `CM4002008`      | RPi CM4 - 2GB RAM, 8GB MMC, No Wifi    |
| `CM4002016`      | RPi CM4 - 2GB RAM, 16GB MMC, No Wifi   |
| `CM4002032`      | RPi CM4 - 2GB RAM, 32GB MMC, No Wifi   |
| `CM4004000`      | RPi CM4 - 4GB RAM, No MMC, No Wifi     |
| `CM4004008`      | RPi CM4 - 4GB RAM, 8GB MMC, No Wifi    |
| `CM4004016`      | RPi CM4 - 4GB RAM, 16GB MMC, No Wifi   |
| `CM4004032`      | RPi CM4 - 4GB RAM, 32GB MMC, No Wifi   |
| `CM4008000`      | RPi CM4 - 8GB RAM, No MMC, No Wifi     |
| `CM4008008`      | RPi CM4 - 8GB RAM, 8GB MMC, No Wifi    |
| `CM4008016`      | RPi CM4 - 8GB RAM, 16GB MMC, No Wifi   |
| `CM4008032`      | RPi CM4 - 8GB RAM, 32GB MMC, No Wifi   |
| `CM4101000`      | RPi CM4 - 1GB RAM, No MMC, With Wifi   |
| `CM4101008`      | RPi CM4 - 1GB RAM, 8GB MMC, With Wifi  |
| `CM4101016`      | RPi CM4 - 1GB RAM, 16GB MMC, With Wifi |
| `CM4101032`      | RPi CM4 - 1GB RAM, 32GB MMC, With Wifi |
| `CM4102000`      | RPi CM4 - 2GB RAM, No MMC, With Wifi   |
| `CM4102008`      | RPi CM4 - 2GB RAM, 8GB MMC, With Wifi  |
| `CM4102016`      | RPi CM4 - 2GB RAM, 16GB MMC, With Wifi |
| `CM4102032`      | RPi CM4 - 2GB RAM, 32GB MMC, With Wifi |
| `CM4104000`      | RPi CM4 - 4GB RAM, No MMC, With Wifi   |
| `CM4104008`      | RPi CM4 - 4GB RAM, 8GB MMC, With Wifi  |
| `CM4104016`      | RPi CM4 - 4GB RAM, 16GB MMC, With Wifi |
| `CM4104032`      | RPi CM4 - 4GB RAM, 32GB MMC, With Wifi |
| `CM4108000`      | RPi CM4 - 8GB RAM, No MMC, With Wifi   |
| `CM4108008`      | RPi CM4 - 8GB RAM, 8GB MMC, With Wifi  |
| `CM4108016`      | RPi CM4 - 8GB RAM, 16GB MMC, With Wifi |
| `CM4108032`      | RPi CM4 - 8GB RAM, 32GB MMC, With Wifi |
| `RPI3-MODAP`     | RPi 3 Model A+ - 512MB RAM             |
| `RPI3-MODB`      | RPi 3 Model B - 1GB RAM                |
| `RPI3-MODBP`     | RPi 3 Model B+ - 1GB RAM               |
| `RPI4-MODBP-1GB` | RPi 4 Model B - 1GB RAM                |
| `RPI4-MODBP-2GB` | RPi 4 Model B - 2GB RAM                |
| `RPI4-MODBP-4GB` | RPi 4 Model B - 4GB RAM                |
| `RPI4-MODBP-8GB` | RPi 4 Model B - 8GB RAM                |
| `SC0020`         | Raspberry Pi Zero W                    |
| `SC0020WH`       | Raspberry Pi Zero W (w/ headers)       |
| `SC0510`         | Raspberry Pi Zero 2 W                  |
| `SC0510WH`       | Raspberry Pi Zero 2 W (w/ headers)     |

## License

```
Copyright (c) rigwild

This license is granted to everyone except for the following entities and
any of their subsidiaries:

- "rpilocator"
- "camerahacks"

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
