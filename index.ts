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

const rapsberryCache = new Map<string, Raspberry>()

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

const parseHTML = (document: Document): Raspberry[] => {
  return [...document.querySelectorAll('tr')]
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
}

const filterRaspberryListBySearchedModels = (raspberryList: Raspberry[]): Raspberry[] => {
  return SEARCHED_RASPBERRY_MODELS?.[0] === '*'
    ? raspberryList
    : raspberryList.filter(x => SEARCHED_RASPBERRY_MODELS.includes(x.sku))
}

const updateRapsberryCache = (raspberryList: Raspberry[]) => {
  let isFirstInit = rapsberryCache.size === 0
  const nowAvailableRaspberryList: Raspberry[] = []
  const nowUnavailableRaspberryList: Raspberry[] = []
  const raspberryListChanges = {
    nowAvailableRaspberryList,
    nowUnavailableRaspberryList
  }

  raspberryList.forEach(raspberry => {
    const key = `${raspberry.sku}-${raspberry.vendor}`
    if (isFirstInit) {
      rapsberryCache.set(key, raspberry)
      // Do not notify on startup
      // if (raspberry.available) nowAvailableRaspberryList.push(raspberry)
      return
    }

    const cachedRaspberry = rapsberryCache.get(key)

    // New Raspberry listing appeared on rpilocator.com
    if (!cachedRaspberry) {
      rapsberryCache.set(key, raspberry)
      if (raspberry.available) nowAvailableRaspberryList.push(raspberry)
      return
    }

    // Alert if the raspberry is now available but was not before
    if (raspberry.available && !cachedRaspberry.available) nowAvailableRaspberryList.push(raspberry)
    // Alert if the raspberry is now unavailable but was before
    if (!raspberry.available && cachedRaspberry.available) nowUnavailableRaspberryList.push(raspberry)

    rapsberryCache.set(key, raspberry)
  })

  if (isFirstInit) isFirstInit = false

  return raspberryListChanges
}

const sendTelegramAlert = async (raspberryListChanges: ReturnType<typeof updateRapsberryCache>) => {
  let message = '🛍️ Raspberry stock changes!'

  const getLink = (r: Raspberry) => {
    const itemLink = USE_DIRECT_PRODUCT_LINK ? r.link : STOCK_URI
    return `[${r.description} | ${r.vendor} | ${r.price}](${itemLink})`
  }

  if (raspberryListChanges.nowAvailableRaspberryList.length > 0) {
    message += `\n\nNew Raspberry in stock! 🔥\n`
    message += raspberryListChanges.nowAvailableRaspberryList.map(r => `✅ ${getLink(r)}`).join('\n')
  }

  if (raspberryListChanges.nowUnavailableRaspberryList.length > 0) {
    message += `\n\nRaspberry now out of stock! 😫\n`
    message += raspberryListChanges.nowUnavailableRaspberryList.map(r => `❌ ${getLink(r)}`).join('\n')
  }

  message += `\n\nStock data from [rpilocator.com](${STOCK_URI})`

  console.log(message)
  await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
}

// let i = 0
const checkStock = async () => {
  console.log('Checking stock...')
  const document = await getHTML()
  let raspberryList = parseHTML(document)
  raspberryList = filterRaspberryListBySearchedModels(raspberryList)
  // console.log(raspberryList)

  // if (i === 1 || i === 3) {
  //   const key = [...rapsberryCache.keys()][50]
  //   raspberryList.find(x => `${x.sku}-${x.vendor}` === key)!.available = true
  // }
  // if (i === 5) {
  //   const key = [...rapsberryCache.keys()][0]
  //   raspberryList.find(x => `${x.sku}-${x.vendor}` === key)!.available = false
  // }
  // if (i === 8) {
  //   const key1 = [...rapsberryCache.keys()][0]
  //   const key2 = [...rapsberryCache.keys()][50]
  //   raspberryList.find(x => `${x.sku}-${x.vendor}` === key1)!.available = false
  //   raspberryList.find(x => `${x.sku}-${x.vendor}` === key2)!.available = true
  // }
  // i++

  const raspberryListChanges = updateRapsberryCache(raspberryList)
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
