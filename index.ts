// @ts-check
import fetch from 'node-fetch'
import { JSDOM } from 'jsdom'
import TelegramBot from 'node-telegram-bot-api'
import { readFileSync, writeFileSync } from 'fs'

const STOCK_URI = 'https://rpilocator.com/'
const SEARCHED_RASPBERRY_MODELS = process.env.SEARCHED_RASPBERRY_MODELS
  ? process.env.SEARCHED_RASPBERRY_MODELS.trim().toLowerCase().split(',')
  : ['*']
const CHECK_INTERVAL = process.env.CHECK_INTERVAL ? +process.env.CHECK_INTERVAL : 60_000

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN!
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!
const TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID = process.env.TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID
  ? +process.env.TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID
  : undefined
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID!
const USE_DIRECT_PRODUCT_LINK = process.env.USE_DIRECT_PRODUCT_LINK === '1'

type Raspberry = {
  sku: string
  description: string
  vendor: string
  price: string
  link: string
  lastStock: string
  available: boolean
}

const rapsberryListCache = new Map<string, Raspberry>()

// Used to get the vendor id from the vendor name for the product link with query string filter
// key=vendor.name, value=vendor.id
const vendorsCache = new Map<string, string>()

// Save the sent messages to udpate them when becomes unavailable
type StockMessageContent = {
  telegramMessage: TelegramBot.Message
  raspberryAvailable: Map<string, Raspberry>
  raspberryUnavailable: Map<string, Raspberry>
}
const lastStockMessagesIds = new Map<string, number>()
const lastStockMessagesContent = new Map<number, StockMessageContent>()

let debugRound = 0

const bot = new TelegramBot(TELEGRAM_TOKEN)
const searchedRaspberryStr =
  SEARCHED_RASPBERRY_MODELS?.[0] === '*' ? ' All' : `\n${SEARCHED_RASPBERRY_MODELS.map(x => `\`${x}\``).join('\n')}`
bot.sendMessage(
  TELEGRAM_ADMIN_CHAT_ID,
  `Bot started! ⚡` +
    `\nLooking for models SKU starting with: ${searchedRaspberryStr}` +
    `\n🌟 Star our [GitHub](https://github.com/rigwild/raspberry-instock-check)`,
  { parse_mode: 'Markdown' }
)
// .then(res => console.log(res.message_id))

const getHTML = async () => {
  let rawHTML = await fetch(`${STOCK_URI}?instock`, {
    headers: { 'User-Agent': 'raspberry_alert telegram bot' }
  }).then(res => res.text())

  if (process.env.NODE_ENV === 'development' && debugRound === 2) {
    // rawHTML = readFileSync('1650901732509.html', 'utf8')
  }

  const dom = new JSDOM(rawHTML)
  return dom.window.document
}

const parseHTMLGetRaspberryList = (document: Document): Raspberry[] => {
  const raspberryList: Raspberry[] = [...document.querySelectorAll('tr')]
    .slice(1)
    .map(x => [x.querySelector('th'), ...x.querySelectorAll('td')])
    .map(trRows => {
      const raspberry: Raspberry = {
        sku: trRows[0]!.textContent!.trim(),
        description: trRows[1]!.textContent!.trim(),
        link: trRows[2]!.querySelector('a')?.href!,
        vendor: trRows[4]!.textContent!.trim(),
        available: trRows[5]!.textContent!.trim().toLowerCase() === 'yes',
        lastStock: trRows[6]!.textContent!.trim(),
        price: trRows[7]!.textContent!.trim()
      }
      if (process.env.NODE_ENV === 'development' && raspberry.available) {
        console.log('wtf available?', {
          sku: trRows[0]!.textContent!.trim(),
          description: trRows[1]!.textContent!.trim(),
          link: trRows[2]!.querySelector('a')?.href!,
          vendor: trRows[4]!.textContent!.trim(),
          available: trRows[5]!.textContent!.trim(),
          lastStock: trRows[6]!.textContent!.trim(),
          price: trRows[7]!.textContent!.trim()
        })
      }
      return raspberry
    })
  return SEARCHED_RASPBERRY_MODELS?.[0] === '*'
    ? raspberryList
    : raspberryList.filter(
        r => r.available && SEARCHED_RASPBERRY_MODELS.some(model => r.sku.toLowerCase().startsWith(model))
      )
}

const updateRapsberryCache = (document: Document) => {
  const raspberryList = parseHTMLGetRaspberryList(document)

  // Testing
  if (process.env.NODE_ENV === 'test') {
    const keys = [...rapsberryListCache.keys()]
    if (debugRound === 1) {
      raspberryList.find(x => getRaspberryKey(x) === keys[50])!.available = true
    }
    if (debugRound === 2) {
      raspberryList.find(x => getRaspberryKey(x) === keys[50])!.available = false
    }
    if (debugRound === 3) {
      raspberryList.find(x => getRaspberryKey(x) === keys[25])!.available = true
      raspberryList.find(x => getRaspberryKey(x) === keys[50])!.available = true
    }
    if (debugRound === 4) {
      raspberryList.find(x => getRaspberryKey(x) === keys[25])!.available = false
      raspberryList.find(x => getRaspberryKey(x) === keys[50])!.available = true
    }
    if (debugRound === 5) {
      raspberryList.find(x => getRaspberryKey(x) === keys[25])!.available = false
      raspberryList.find(x => getRaspberryKey(x) === keys[50])!.available = false
    }
  }

  let isFirstInit = rapsberryListCache.size === 0
  const nowAvailableRaspberry: Map<string, Raspberry> = new Map()
  const nowUnavailableRaspberry: Map<string, Raspberry> = new Map()
  const raspberryListWithChanges = {
    raspberryList,
    nowAvailableRaspberry,
    nowUnavailableRaspberry
  }

  raspberryList.forEach(raspberry => {
    const raspberryKey = getRaspberryKey(raspberry)
    if (isFirstInit) {
      rapsberryListCache.set(raspberryKey, raspberry)
      // Do not notify on startup
      // if (raspberry.available) nowAvailableRaspberryList.push(raspberry)
      return
    }

    const cachedRaspberry = rapsberryListCache.get(raspberryKey)

    // New Raspberry listing appeared on rpilocator.com
    if (!cachedRaspberry) {
      rapsberryListCache.set(raspberryKey, raspberry)
      if (raspberry.available) nowAvailableRaspberry.set(raspberryKey, raspberry)
      return
    }

    // Alert if the raspberry is now available but was not before
    if (raspberry.available && !cachedRaspberry.available) {
      nowAvailableRaspberry.set(raspberryKey, raspberry)
    }
    // Alert if the raspberry is now unavailable but was before
    if (!raspberry.available && cachedRaspberry.available) {
      nowUnavailableRaspberry.set(raspberryKey, raspberry)
    }

    rapsberryListCache.set(raspberryKey, raspberry)
  })

  if (isFirstInit) isFirstInit = false

  return raspberryListWithChanges
}

const updateVendorsCache = (document: Document) => {
  ;[...document.querySelectorAll('a[data-vendor]')]
    .map(x => {
      const [country, ...vendorName] = x.textContent!.trim().split(' ')
      return {
        id: x.getAttribute('data-vendor'),
        name: `${vendorName.join(' ')} ${country}`.trim()
      }
    })
    .forEach(({ id, name }) => vendorsCache.set(name, id))
  vendorsCache.delete('All')
}

const getRaspberryLink = (r: Raspberry) => {
  let itemLink: string
  let urlQueries: Array<[string, string]> = []
  if (USE_DIRECT_PRODUCT_LINK) itemLink = r.link
  else {
    itemLink = STOCK_URI
    if (vendorsCache.has(r.vendor)) urlQueries.push(['vendor', vendorsCache.get(r.vendor)])
  }
  urlQueries.push(['utm_source', 'telegram'])
  urlQueries.push(['utm_medium', 'rapsberry_alert'])
  itemLink += '?' + urlQueries.map(([k, v]) => `${k}=${v}`).join('&')
  return `[${r.description} | ${r.vendor} | ${r.price}](${itemLink})`
}

const getRaspberryKey = (r: Raspberry) => `${r.sku}-${r.vendor}-${r.price}`

const twoDigits = (serializable: any) => serializable.toString().padStart(2, '0')

/**
 * Transform a date object to a human-readable date format
 * `2019-12-31`
 * @param date Date to format
 * @returns formated date
 * @see https://gist.github.com/rigwild/bf712322eac2244096468985ee4a5aae
 */
export const toHumanDate = (date: Date) =>
  `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`

/**
 * Transform a date object to a human-readable datetime format
 * `2019-12-31 - 24:60:60`
 * @param date Date to format
 * @returns formated datetime
 * @see https://gist.github.com/rigwild/bf712322eac2244096468985ee4a5aae
 */
export const toHumanDateTime = (date: Date) =>
  `${toHumanDate(date)} - ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`

const getTelegramMessage = (
  raspberryAvailabilities: ReturnType<typeof updateRapsberryCache>,
  nowAvailableRaspberryListLastStockMessagesKeys?: string[]
) => {
  let message = '🛍️ Raspberry stock changes!'

  if (raspberryAvailabilities.nowAvailableRaspberry.size > 0) {
    message += `\n\nNew Raspberry in stock! 🔥🔥\n`
    message += [...raspberryAvailabilities.nowAvailableRaspberry.values()]
      .map(r => {
        const raspberryKey = getRaspberryKey(r)
        if (nowAvailableRaspberryListLastStockMessagesKeys) {
          nowAvailableRaspberryListLastStockMessagesKeys.push(raspberryKey)
        }
        return `✅ ${getRaspberryLink(r)}`
      })
      .join('\n')
  }

  if (raspberryAvailabilities.nowUnavailableRaspberry.size > 0) {
    message += `\n\nNow out of stock! 😔\n`
    message += [...raspberryAvailabilities.nowUnavailableRaspberry.values()]
      .map(r => `❌ ${getRaspberryLink(r)}`)
      .join('\n')
  }

  // message += `\n\nCurrently in stock:\n`
  // // Get links and remove duplicates
  // const links = new Set(raspberryAvailabilities.raspberryList.filter(r => r.available).map(r => getRaspberryLink(r)))
  // message += [...links].join('\n')

  message += '\n\n🌟 Star our [GitHub](https://github.com/rigwild/raspberry-instock-check)'
  message += `\n🌐 Stock data from [rpilocator](${STOCK_URI}?utm_source=telegram&utm_medium=rapsberry_alert)`
  return message
}

const sendTelegramAlert = async (raspberryListWithChanges: ReturnType<typeof updateRapsberryCache>) => {
  const nowAvailableRaspberryListLastStockMessagesKeys = []
  const message = getTelegramMessage(raspberryListWithChanges, nowAvailableRaspberryListLastStockMessagesKeys)
  console.log(message)
  console.log(raspberryListWithChanges.nowAvailableRaspberry)

  const sentMsg = await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })

  // Record the message to update it later
  nowAvailableRaspberryListLastStockMessagesKeys.forEach(raspberryKey => {
    const raspberryAvailable = new Map()
    raspberryListWithChanges.nowAvailableRaspberry.forEach(raspberry => {
      raspberryAvailable.set(raspberryKey, raspberry)
    })

    const messageContent = {
      telegramMessage: sentMsg,
      raspberryAvailable,
      raspberryUnavailable: new Map()
    }
    lastStockMessagesIds.set(raspberryKey, sentMsg.message_id)
    lastStockMessagesContent.set(sentMsg.message_id, messageContent)

    // Delete key in 24 hours
    setTimeout(() => {
      lastStockMessagesIds.delete(raspberryKey)
      lastStockMessagesContent.delete(sentMsg.message_id)
    }, 24 * 60 * 60 * 1000)
  })
}

const updateTelegramAlert = async (raspberryListWithChanges: ReturnType<typeof updateRapsberryCache>) => {
  for (const raspberry of raspberryListWithChanges.nowUnavailableRaspberry.values()) {
    const raspberryKey = getRaspberryKey(raspberry)
    if (lastStockMessagesIds.has(raspberryKey)) {
      console.log(`Now unavailable: ${raspberryKey}`)
      const message_id = lastStockMessagesIds.get(raspberryKey)
      const lastMessageContent = lastStockMessagesContent.get(message_id)
      lastMessageContent.raspberryAvailable.delete(raspberryKey)
      lastMessageContent.raspberryUnavailable.set(raspberryKey, raspberry)
      const raspberryAvailabilities = {
        raspberryList: raspberryListWithChanges.raspberryList,
        nowAvailableRaspberry: lastMessageContent.raspberryAvailable,
        nowUnavailableRaspberry: lastMessageContent.raspberryUnavailable
      }
      lastMessageContent.telegramMessage.text = getTelegramMessage(raspberryAvailabilities)
      await bot.editMessageText(lastMessageContent.telegramMessage.text, {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: lastMessageContent.telegramMessage.message_id,
        parse_mode: 'Markdown'
      })
    }
  }
}

const checkStock = async () => {
  if (process.env.NODE_ENV === 'development') console.log(debugRound)

  try {
    console.log('Checking stock...')

    // Do the request 2 times and check the result is the same
    // Sometimes rpilocator returns invalid data (race condition when updating on their side)
    const [document, documentDoubleCheck] = await Promise.all([getHTML(), getHTML()])
    if (
      document.body.querySelector('#prodTable').innerHTML.replace(/\n/g, '') !==
      documentDoubleCheck.body.querySelector('#prodTable').innerHTML.replace(/\n/g, '')
    ) {
      const timestamp = Date.now()
      writeFileSync(`invalid-double-check-${timestamp}-1.html`, document.body.innerHTML.replace(/\n/g, ''))
      writeFileSync(`invalid-double-check-${timestamp}-2.html`, documentDoubleCheck.body.innerHTML.replace(/\n/g, ''))
      console.error('Detected invalid data when double checking')
      return
    }

    updateVendorsCache(document)
    const raspberryListWithChanges = updateRapsberryCache(document)
    console.log('nowAvailableRaspberry', raspberryListWithChanges.nowAvailableRaspberry)
    // console.log(raspberryListWithChanges)

    if (raspberryListWithChanges.nowAvailableRaspberry.size > 0) {
      await sendTelegramAlert(raspberryListWithChanges)
      if (process.env.NODE_ENV === 'development')
        writeFileSync(`now-available-${Date.now()}.html`, document.body.innerHTML)
    } else {
      console.log('Not in stock!')
    }
    if (raspberryListWithChanges.nowUnavailableRaspberry.size > 0) {
      await updateTelegramAlert(raspberryListWithChanges)
    }
  } catch (error) {
    console.error(error)
    await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `❌ Error!\n${error.message}\n\`\`\`${error.stack}\`\`\``, {
      parse_mode: 'Markdown'
    })
  }
  debugRound++
}

const liveStockUpdate = async () => {
  if (!TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID) return

  let message = '🔴🤖 Live Raspberry Stock Update\n\n'

  const available = [...new Set([...rapsberryListCache.values()])]
    .filter(x => x.available)
    .map(r => `✅ ${getRaspberryLink(r)}`)
  message += available.length > 0 ? available.join('\n') : '🤷‍♀️ Nothing available right now'

  message += '\n\n🌟 Star our [GitHub](https://github.com/rigwild/raspberry-instock-check)'
  message += '\n🌐 Stock data from [rpilocator](https://rpilocator.com/?utm_source=telegram&utm_medium=rapsberry_alert)'
  message += `\n\n🔄 Last update at ${toHumanDateTime(new Date())}`

  await bot
    .editMessageText(message, {
      chat_id: TELEGRAM_CHAT_ID,
      message_id: TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID,
      parse_mode: 'Markdown'
    })
    .catch(() => {})
}

checkStock().finally(() => {
  liveStockUpdate()
  setInterval(checkStock, CHECK_INTERVAL)
  setInterval(liveStockUpdate, 10_000)
})
