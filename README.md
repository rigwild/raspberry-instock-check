# Raspberry instock check bot

Get an alert on Telegram when there are Raspberry in stock ready to buy. This bot uses [rpilocator](https://rpilocator.com/) to check for stock updates.

Join the public Telegram channel to get notifications! [@raspberry_alert](https://t.me/raspberry_alert/35)

🌟 Star the project if we helped you get a Raspberry! 🙏

## Features

- Send an alert when a new Raspberry is in stock

![screenshot](./screenshot.png)

- Live update a message with currently in stock Raspberry

![screenshot live update](./screenshot-live.png)

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

| Environment variable                     | Required | Description                                                                                    |
| ---------------------------------------- | :------: | ---------------------------------------------------------------------------------------------- |
| `TELEGRAM_TOKEN`                         |    ✅    | Telegram bot token                                                                             |
| `TELEGRAM_ADMIN_CHAT_ID`                 |    ✅    | Telegram chat id where to send error messages (can be the same as `TELEGRAM_CHAT_ID`)          |
| `TELEGRAM_CHAT_ID`                       |    ✅    | Telegram chat id where to send stock alerts and update the live stock update message           |
| `TELEGRAM_CURRENTLY_IN_STOCK_MESSAGE_ID` |          | Telegram message id to update with the current stock                                           |
| `USE_DIRECT_PRODUCT_LINK`                |          | Should the products links be direct product links? (if `0`, will send rpilocator link)         |
| `SEARCHED_RASPBERRY_MODELS`              |          | List of Raspberry models to look for, separated by a `,`. If omitted, will look for all models |
| `PROXY`                                  |          | Proxy to use to fetch data from rpilocator                                                     |
| `CHECK_INTERVAL`                         |          | Check interval in ms, checking too often might get you rate-limited (default is `60000`)       |

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

## Test

To simulate some alerts to see if it's working, set the environment variable `NODE_ENV=test`.

## List of Raspberry models

| Model (SKU)      | Description                            |
| ---------------- | -------------------------------------- |
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
| `RPI3-MODAP`     | RPi 3 Model A                          |
| `RPI3-MODBP`     | RPi 3 Model B                          |
| `RPI4-MODBP-1GB` | RPi 4 Model B - 1GB RAM                |
| `RPI4-MODBP-2GB` | RPi 4 Model B - 2GB RAM                |
| `RPI4-MODBP-4GB` | RPi 4 Model B - 4GB RAM                |
| `RPI4-MODBP-8GB` | RPi 4 Model B - 8GB RAM                |
| `SC0510`         | Raspberry Pi Zero 2 W                  |
| `SC0510WH`       | Raspberry Pi Zero 2 W (w/ headers)     |

## License

```
           DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                   Version 2, December 2004

Copyright (C) 2022 rigwild <me@rigwild.dev> (https://rigwild.dev/)

Everyone is permitted to copy and distribute verbatim or modified
copies of this license document, and changing it is allowed as long
as the name is changed.

           DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
  TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

 0. You just DO WHAT THE FUCK YOU WANT TO.
```
