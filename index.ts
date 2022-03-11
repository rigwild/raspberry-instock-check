// @ts-check
import fetch from 'node-fetch'
import { JSDOM } from 'jsdom'
import TelegramBot from 'node-telegram-bot-api'

const STOCK_URI = 'https://rpilocator.com/'
const SEARCHED_RASPBERRY_MODELS = process.env.SEARCHED_RASPBERRY_MODELS
  ? process.env.SEARCHED_RASPBERRY_MODELS.split(',')
  : ['*']
const CHECK_INTERVAL = process.env.CHECK_INTERVAL ? +process.env.CHECK_INTERVAL : 60_000

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN!
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!
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

let debugRound = 0

const bot = new TelegramBot(TELEGRAM_TOKEN)
bot.sendMessage(
  TELEGRAM_ADMIN_CHAT_ID,
  `Bot started! ⚡ Looking for models:${
    SEARCHED_RASPBERRY_MODELS?.[0] === '*' ? ' All' : '\n' + SEARCHED_RASPBERRY_MODELS.map(x => `\`${x}\``).join('\n')
  }\nhttps://github.com/rigwild/raspberry-instock-check`,
  { parse_mode: 'Markdown' }
)

const getHTML = async () => {
  const rawHTML = await fetch(STOCK_URI).then(res => res.text())
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
      return raspberry
    })
  return SEARCHED_RASPBERRY_MODELS?.[0] === '*'
    ? raspberryList
    : raspberryList.filter(x => SEARCHED_RASPBERRY_MODELS.includes(x.sku))
}

const updateRapsberryCache = (document: Document) => {
  const raspberryList = parseHTMLGetRaspberryList(document)

  if (process.env.NODE_ENV === 'development') {
    const key0 = [...rapsberryListCache.keys()][0]
    const key50 = [...rapsberryListCache.keys()][50]
    if (debugRound === 1 || debugRound === 3) {
      raspberryList.find(x => `${x.sku}-${x.vendor}` === key50)!.available = true
    }
    if (debugRound === 5) {
      raspberryList.find(x => `${x.sku}-${x.vendor}` === key0)!.available = false
    }
    if (debugRound === 8) {
      raspberryList.find(x => `${x.sku}-${x.vendor}` === key0)!.available = false
      raspberryList.find(x => `${x.sku}-${x.vendor}` === key50)!.available = true
    }
    debugRound++
  }

  let isFirstInit = rapsberryListCache.size === 0
  const nowAvailableRaspberryList: Raspberry[] = []
  const nowUnavailableRaspberryList: Raspberry[] = []
  const raspberryListWithChanges = {
    raspberryList,
    nowAvailableRaspberryList,
    nowUnavailableRaspberryList
  }

  raspberryList.forEach(raspberry => {
    const key = `${raspberry.sku}-${raspberry.vendor}`
    if (isFirstInit) {
      rapsberryListCache.set(key, raspberry)
      // Do not notify on startup
      // if (raspberry.available) nowAvailableRaspberryList.push(raspberry)
      return
    }

    const cachedRaspberry = rapsberryListCache.get(key)

    // New Raspberry listing appeared on rpilocator.com
    if (!cachedRaspberry) {
      rapsberryListCache.set(key, raspberry)
      if (raspberry.available) nowAvailableRaspberryList.push(raspberry)
      return
    }

    // Alert if the raspberry is now available but was not before
    if (raspberry.available && !cachedRaspberry.available) nowAvailableRaspberryList.push(raspberry)
    // Alert if the raspberry is now unavailable but was before
    // if (!raspberry.available && cachedRaspberry.available) nowUnavailableRaspberryList.push(raspberry)

    rapsberryListCache.set(key, raspberry)
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

const sendTelegramAlert = async (raspberryListWithChanges: ReturnType<typeof updateRapsberryCache>) => {
  let message = '🛍️ Raspberry stock changes!'

  const getLink = (r: Raspberry) => {
    let itemLink: string
    if (USE_DIRECT_PRODUCT_LINK) itemLink = r.link
    else {
      itemLink = STOCK_URI
      if (vendorsCache.has(r.vendor)) itemLink += `?vendor=${vendorsCache.get(r.vendor)}`
    }
    return `[${r.description} | ${r.vendor} | ${r.price}](${itemLink})`
  }

  if (raspberryListWithChanges.nowAvailableRaspberryList.length > 0) {
    message += `\n\nNew Raspberry in stock! 🔥🔥\n`
    message += raspberryListWithChanges.nowAvailableRaspberryList.map(r => `✅ ${getLink(r)}`).join('\n')
  }

  // Disabled
  if (raspberryListWithChanges.nowUnavailableRaspberryList.length > 0) {
    message += `\n\nRaspberry now out of stock! 😫\n`
    message += raspberryListWithChanges.nowUnavailableRaspberryList.map(r => `❌ ${getLink(r)}`).join('\n')
  }

  message += `\n\nCurrently in stock:\n`
  message += raspberryListWithChanges.raspberryList
    .filter(r => r.available)
    .map(r => getLink(r))
    .join('\n')

  message += `\n\nStock data from [rpilocator.com](${STOCK_URI})`

  console.log(message)
  await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
}

const checkStock = async () => {
  console.log('Checking stock...')
  const document = await getHTML()

  updateVendorsCache(document)
  const raspberryListChanges = updateRapsberryCache(document)
  // console.log(nowAvailableRaspberryList)

  if (
    raspberryListChanges.nowAvailableRaspberryList.length > 0 ||
    raspberryListChanges.nowUnavailableRaspberryList.length > 0
  )
    await sendTelegramAlert(raspberryListChanges)
  else console.log('Not in stock!')
}

checkStock()
setInterval(checkStock, CHECK_INTERVAL)
