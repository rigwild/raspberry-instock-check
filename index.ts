// @ts-check
import fetch from 'node-fetch'
import { JSDOM } from 'jsdom'
import TelegramBot from 'node-telegram-bot-api'
import { readFileSync, writeFileSync } from 'fs'
import HttpsProxyAgentImport from 'https-proxy-agent'
const { HttpsProxyAgent } = HttpsProxyAgentImport

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

const PROXY = process.env.PROXY

type Raspberry = {
  sku: string
  description: string
  vendor: string
  price: string
  link: string
  lastStock: string
  available: boolean
}

let isFirstInit = true
const raspberryAvailableCache = new Map<string, Raspberry>()

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
    (PROXY ? `\nUsing proxy: ${new URL(PROXY).hostname}:${new URL(PROXY).port}` : '') +
    `\n🌟 Star our [GitHub](https://github.com/rigwild/raspberry-instock-check)`,
  { parse_mode: 'Markdown' }
)
// .then(res => console.log(res.message_id))

const getHTML = async () => {
  let rawHTML: string

  if (process.env.NODE_ENV === 'test') {
    rawHTML = readFileSync('../_mock_fetched_data_full.html', { encoding: 'utf-8' })
  } else {
    rawHTML = await fetch(`${STOCK_URI}?instock`, {
      headers: { 'User-Agent': 'raspberry_alert telegram bot' },
      agent: PROXY ? new HttpsProxyAgent(PROXY) : undefined
    }).then(res => res.text())
  }

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
        console.log('Available in current round', {
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
  const _raspberryList = parseHTMLGetRaspberryList(document)

  // Mock data for testing
  if (process.env.NODE_ENV === 'test') {
    const setAvailable = (index: number, status: boolean) => (_raspberryList[index].available = status)
    if (debugRound === 0) setAvailable(50, false)
    if (debugRound === 1) setAvailable(50, true)
    if (debugRound === 2) setAvailable(50, false)
    if (debugRound === 3) {
      setAvailable(25, true)
      setAvailable(50, true)
    }
    if (debugRound === 4) {
      setAvailable(25, false)
      setAvailable(50, true)
    }
    if (debugRound === 5) {
      setAvailable(25, false)
      setAvailable(50, false)
    }
  }

  const raspberryList = _raspberryList.filter(x => x.available)
  const raspberryAvailable = new Map() as typeof raspberryAvailableCache
  raspberryList.forEach(raspberry => raspberryAvailable.set(getRaspberryKey(raspberry), raspberry))

  const raspberryListWithChanges = {
    nowAvailableRaspberry: new Map() as Map<string, Raspberry>,
    nowUnavailableRaspberry: new Map() as Map<string, Raspberry>
  }

  // Do not alert on startup, only fill the cache
  if (isFirstInit) {
    ;[...raspberryAvailable.entries()].forEach(([raspberryKey, raspberry]) =>
      raspberryAvailableCache.set(raspberryKey, raspberry)
    )
    isFirstInit = false
    return raspberryListWithChanges
  }

  // Find the raspberrys that are available now but were not before
  ;[...raspberryAvailable.entries()].forEach(([raspberryKey, raspberry]) => {
    if (!raspberryAvailableCache.has(raspberryKey))
      raspberryListWithChanges.nowAvailableRaspberry.set(raspberryKey, raspberry)
  })

  // Find the raspberrys that are not available now but were before
  ;[...raspberryAvailableCache.entries()]
    .filter(([raspberryKey, raspberry]) => !raspberryAvailable.has(raspberryKey))
    .forEach(([raspberryKey, raspberry]) =>
      raspberryListWithChanges.nowUnavailableRaspberry.set(raspberryKey, raspberry)
    )

  // Update the raspberry cache
  raspberryAvailableCache.clear()
  ;[...raspberryAvailable.entries()].forEach(([raspberryKey, raspberry]) =>
    raspberryAvailableCache.set(raspberryKey, raspberry)
  )

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
  console.log(raspberryListWithChanges.nowAvailableRaspberry)
  console.log(message)

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

    // Do the request 2 times with a bit of delay and check the result is the same
    // Sometimes rpilocator returns invalid data (race condition when updating on their side)
    const [document, documentDoubleCheck] = await Promise.all([
      getHTML(),
      new Promise(resolve => setTimeout(() => resolve(getHTML()), 1000)) as Promise<Document>
    ])

    const documentTable = document.body.querySelector('#prodTable')
    const documentDoubleCheckTable = documentDoubleCheck.body.querySelector('#prodTable')
    if (
      !documentTable ||
      !documentDoubleCheckTable ||
      documentTable.innerHTML.replace(/\s/g, '') !== documentDoubleCheckTable.innerHTML.replace(/\s/g, '')
    ) {
      const timestamp = Date.now()
      writeFileSync(`invalid-double-check-${timestamp}-1.html`, document.body.innerHTML.replace(/\s/g, ''))
      writeFileSync(`invalid-double-check-${timestamp}-2.html`, documentDoubleCheck.body.innerHTML.replace(/\s/g, ''))
      console.error('Detected invalid data when double checking')
      return
    }

    updateVendorsCache(document)
    const raspberryListWithChanges = updateRapsberryCache(document)
    // console.log('nowAvailableRaspberry', raspberryListWithChanges.nowAvailableRaspberry)
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

  const available = [...new Set([...raspberryAvailableCache.values()])]
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
  setInterval(checkStock, CHECK_INTERVAL + Math.random() * 3000)
  setInterval(liveStockUpdate, process.env.NODE_ENV === 'test' ? 2000 : 10_000)
})
