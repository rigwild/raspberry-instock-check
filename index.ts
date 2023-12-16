import fetch from 'node-fetch'
import TelegramBot from 'node-telegram-bot-api'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import HttpsProxyAgentImport from 'https-proxy-agent'
const { HttpsProxyAgent } = HttpsProxyAgentImport
import { startServer } from './server.js'

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
const USE_CACHED_REQUEST = process.env.USE_CACHED_REQUEST === '1'
const API_RUN = process.env.API_RUN === '1'

const PROXY = process.env.PROXY

type Raspberry = {
  update_t: { sort: number; display: string }
  price: { sort: number; display: string; currency: string }
  vendor: string
  sku: string
  avail: string
  link: string
  last_stock: { sort: string; display: string }
  description: string
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/112.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36 OPR/97.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; rv:112.0) Gecko/20100101 Firefox/112.0',
]

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.NODE_ENV !== 'development' &&
  !USE_CACHED_REQUEST &&
  CHECK_INTERVAL < 25_000
)
  throw new Error('CHECK_INTERVAL must be at least 25000 ms')

const pickRandom = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)]

let isFirstInit = true
let rpilocatorCookies: string
let currentUserAgent: string
const raspberryAvailableCache = new Map<string, Raspberry>()

let lastCookiesRefresh = Date.now()
const COOKIES_REFRESH_INTERVAL = 3 * 60 * 1000 // 3 minutes

/**
 * List of errors when fetching data from rpilocator
 * When `ERRORS_SKIP_THRESOLD` is reached in a time window of `ERRORS_SKIP_TIME_WINDOW`,
 * skip the next `ERRORS_SKIP_CYCLES` fetch cycles, then reset
 */
let fetchErrors: Date[] = []
let fetchErrorsSkipCyclesLeft = 0
const ERRORS_SKIP_THRESOLD = 5
const ERRORS_SKIP_TIME_WINDOW = 5 * 60_000 // Look at last 5 minutes
const hasReachedErrorsSkipThresold = () => {
  const now = Date.now()
  // Remove errors that are outside the time window
  fetchErrors = fetchErrors.filter(x => x.getTime() > now - ERRORS_SKIP_TIME_WINDOW)
  return fetchErrors.length >= ERRORS_SKIP_THRESOLD
}
const ERRORS_SKIP_CYCLES = () => 4 + (Math.floor(Math.random() * 10) % 11) // 4 <= x <= 13

// Save the sent messages to udpate them when becomes unavailable
type StockMessageContent = {
  telegramMessage: TelegramBot.Message
  raspberryAvailable: Map<string, Raspberry>
  raspberryUnavailable: Map<string, Raspberry>
}
const lastStockMessagesIds = new Map<string, number>()
const lastStockMessagesContent = new Map<number, StockMessageContent>()

const vendors = {
  '330ohms (MX)': '330ohms',
  'Adafruit (US)': 'adafruit',
  'Argon 40 (CN)': 'argon40',
  'BerryBase (DE)': 'berrybase',
  'Botland (PL)': 'botland',
  'Chicago Elec. Dist. (US)': 'chicagodist',
  'Cool Components (UK)': 'coolcomp',
  'Digi-Key (US)': 'digikeyus',
  'electro:kit (SE)': 'electrokit',
  'Elektor (NL)': 'elektor',
  'Elektronica Voor Jou (NL)': 'elektronica',
  'Farnell (UK)': 'farnell',
  'Jkollerup.dk (DK)': 'jkollerup',
  'Kamami (PL)': 'kamami',
  'Kiwi Elec. (NL)': 'kiwinl',
  'Kubii (FR)': 'kubii',
  'MC Hobby (BE)': 'mchobby',
  'Melopero (IT)': 'melopero',
  'Newark (US)': 'newark',
  'Pi Australia (AU)': 'piaustralia',
  'Pi-Shop (CH)': 'pishopch',
  'pi3g (DE)': 'pi3g',
  'Pimoroni (UK)': 'pimoroni',
  'Pishop (CA)': 'pishopca',
  'Pishop (US)': 'pishopus',
  'PiShop (ZA)': 'pishopza',
  'Rapid (UK)': 'rapid',
  'RaspberryStore (NL)': 'raspberrystore',
  'Rasppishop (DE)': 'rasppishop',
  'Reichelt (DE)': 'reichelt',
  'Robert Mauser (PT)': 'mauserpt',
  'Robox (MA)': 'robox',
  'SAMM Market (TR)': 'samm',
  'Seeedstudio (CN)': 'seeedstudio',
  'Semaf (AT)': 'semaf',
  'The Pi Hut (UK)': 'thepihut',
  'Thingbits (IN)': 'thingbits',
  'Tiendatec (ES)': 'tiendatec',
  'Welectron (DE)': 'welectron',
  'Yadom (FR)': 'yadom',
}

let debugRound = 0

const bot = new TelegramBot(TELEGRAM_TOKEN)
const searchedRaspberryStr =
  SEARCHED_RASPBERRY_MODELS?.[0] === '*' ? ' All' : `\n${SEARCHED_RASPBERRY_MODELS.map(x => `\`${x}\``).join('\n')}`
bot.sendMessage(
  TELEGRAM_ADMIN_CHAT_ID,
  `Bot started! ⚡` +
    `\nLooking for models SKU starting with: ${searchedRaspberryStr}` +
    (PROXY ? `\nUsing proxy: ${new URL(PROXY).hostname}:${new URL(PROXY).port}` : '') +
    `\n🌟 Star on [GitHub](https://github.com/rigwild/raspberry-instock-check)`,
  { parse_mode: 'Markdown' }
)
// .then(res => console.log(res.message_id))

const getRpilocatorTokenAndCookies = async () => {
  console.log('Getting new rpilocator token and cookies')

  currentUserAgent = pickRandom(USER_AGENTS)
  rpilocatorCookies = ''

  const reqHome = await fetch('https://rpilocator.com/', {
    headers: {
      'User-Agent': currentUserAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
    agent: PROXY ? new HttpsProxyAgent(PROXY) : undefined,
  })

  // prettier-ignore
  rpilocatorCookies = reqHome.headers.raw()['set-cookie'].map(x => x.split(';')[0]).join('; ')
  console.log('rpilocatorCookies', rpilocatorCookies)
  console.log('currentUserAgent', currentUserAgent)
}

const getRaspberryList = async (): Promise<Raspberry[]> => {
  if (process.env.NODE_ENV === 'test' || USE_CACHED_REQUEST) {
    // Load from file system cache instead of fetching from rpilocator
    let fileName = '_mock_fetched_data_full.json'
    if (USE_CACHED_REQUEST) fileName = './_cached_request_data.json'

    let filePath = new URL(fileName, import.meta.url)
    if (!existsSync(filePath)) filePath = new URL(`../${fileName}`, filePath)
    if (!existsSync(filePath))
      throw new Error('Cached request file not found! Start your other checker instance first!')

    return JSON.parse(readFileSync(filePath, { encoding: 'utf-8' }))._data
  }

  // Refresh cookies
  if (!rpilocatorCookies || Date.now() - lastCookiesRefresh > COOKIES_REFRESH_INTERVAL) {
    await getRpilocatorTokenAndCookies()
    lastCookiesRefresh = Date.now()
  }

  // Fetch stock data
  let reqData: Awaited<ReturnType<typeof fetch>>
  try {
    reqData = await fetch(`https://rpilocator.com/data.cfm?method=getProductTable&instock&&_=${Date.now()}`, {
      headers: {
        'User-Agent': currentUserAgent,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.5',
        'X-Requested-With': 'XMLHttpRequest',
        'Alt-Used': 'rpilocator.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        cookie: rpilocatorCookies,
        referer: 'https://rpilocator.com/',
      },
      agent: PROXY ? new HttpsProxyAgent(PROXY) : undefined,
    })
  } catch (error) {
    // If DNS error, log error but do not alert telegram admin
    if (error.message.includes('getaddrinfo EAI_AGAIN')) {
      console.error(error)
      return null as any
    }
    throw error
  }

  // if (reqData.status === 403) {
  //   // Try to get a new token and retry in 10s
  //   await new Promise(resolve => setTimeout(resolve, 3000))
  //   await getRpilocatorTokenAndCookies()
  //   return getRaspberryList()
  // }

  if (!reqData.ok)
    throw new Error(`Failed to fetch API data! - Status ${reqData.status}\n${(await reqData.text()).slice(0, 4000)}`)

  let raspberryList: Raspberry[]
  let raspberryListJson = await reqData.text()
  try {
    // writeFileSync(new URL(`log-${Date.now()}.html`, import.meta.url), raspberryListJson)
    raspberryList = JSON.parse(raspberryListJson).data.sort((a, b) =>
      getRaspberryKey(a).localeCompare(getRaspberryKey(b))
    )
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log(reqData.status, reqData.statusText)
      console.log(rpilocatorCookies)
      writeFileSync(new URL(`log-${Date.now()}.html`, import.meta.url), raspberryListJson)
    }
    throw new Error(`API data was not JSON!\n${raspberryListJson.slice(0, 2000)}`)
  }
  return raspberryList
}

const updateRapsberryCache = (raspberryList: Raspberry[]) => {
  raspberryList = raspberryList.filter(r => r.avail === 'Yes')
  if (SEARCHED_RASPBERRY_MODELS?.[0] !== '*')
    raspberryList = raspberryList.filter(r =>
      SEARCHED_RASPBERRY_MODELS.some(model => r.sku.toLowerCase().startsWith(model))
    )

  // Mock data for testing
  if (process.env.NODE_ENV === 'test') {
    const mock1 = {
      sku: 'RPI4-MODBP-4GB',
      description: 'RPi 4 Model B - 4GB RAM',
      vendor: 'electro:kit (SE)',
      price: { display: '719.00', currency: 'SEK' },
      link: 'https://www.pi-shop.ch/raspberry-pi-3-model-a',
    }
    const mock2 = {
      sku: 'CM4104000',
      description: 'RPi CM4 - 4GB RAM, No MMC, With Wifi',
      vendor: 'Welectron (DE)',
      price: { display: '64.90', currency: 'EUR' },
      link: 'https://www.pi-shop.ch/raspberry-pi-3-model-a',
    }
    if (debugRound === 1) {
      raspberryList.push(mock1 as any)
      // raspberryList.push(mock2 as any)
    }
    if (debugRound === 2) {
      // raspberryList.push(mock1 as any)
      // raspberryList.push(mock2 as any)
    }
    if (debugRound === 3) {
      raspberryList.push(mock1 as any)
      raspberryList.push(mock2 as any)
    }
    if (debugRound === 4) {
      // raspberryList.push(mock1 as any)
      raspberryList.push(mock2 as any)
    }
    if (debugRound === 5) {
      // raspberryList.push(mock1 as any)
      // raspberryList.push(mock2 as any)
    }
  }
  const raspberryAvailable = new Map() as typeof raspberryAvailableCache
  raspberryList.forEach(raspberry => raspberryAvailable.set(getRaspberryKey(raspberry), raspberry))

  const raspberryListWithChanges = {
    nowAvailableRaspberry: new Map<string, Raspberry>(),
    nowUnavailableRaspberry: new Map<string, Raspberry>(),
  }

  // Do not alert on first lauch (startup), only fill the cache
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

const getRaspberryLink = (r: Raspberry) => {
  let itemLink = r.link
  if (!USE_DIRECT_PRODUCT_LINK) {
    itemLink = `https://rpilocator.com/?utm_source=telegram&utm_medium=rapsberry_alert`
    if (vendors[r.vendor]) itemLink += `&vendor=${vendors[r.vendor]}`
  }
  return `[${r.description} | ${r.vendor} | ${r.price.display} ${r.price.currency}](${itemLink})`
}

const getRaspberryKey = (r: Raspberry) => `${r.sku}-${r.vendor}-${r.price.display}`

const twoDigits = (serializable: any) => serializable.toString().padStart(2, '0')

/** @see https://gist.github.com/rigwild/bf712322eac2244096468985ee4a5aae */
export const toHumanDateTime = (date: Date) =>
  `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} - ${twoDigits(
    date.getHours()
  )}:${twoDigits(date.getMinutes())}`

/** Check if provided lists are identical, will deep copy and delete `update_t` key as it changes frequently */
const areIdentical = (raspberryList: Raspberry[], raspberryListDoubleCheck: Raspberry[]): boolean => {
  const a = JSON.parse(JSON.stringify(raspberryList))
  const b = JSON.parse(JSON.stringify(raspberryListDoubleCheck))
  a.forEach(r => delete r.update_t)
  b.forEach(r => delete r.update_t)
  return JSON.stringify(a) === JSON.stringify(b)
}

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

  message += '\n\n🌟 Star on [GitHub](https://github.com/rigwild/raspberry-instock-check)'
  message += `\n🌐 Stock data from [rpilocator](https://rpilocator.com/?utm_source=telegram&utm_medium=rapsberry_alert)`
  return message
}

const sendTelegramAlert = async (raspberryListWithChanges: ReturnType<typeof updateRapsberryCache>) => {
  const nowAvailableRaspberryListLastStockMessagesKeys = []
  const message = getTelegramMessage(raspberryListWithChanges, nowAvailableRaspberryListLastStockMessagesKeys)
  console.log(raspberryListWithChanges.nowAvailableRaspberry)
  console.log(message)

  const sentMsg = await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  })

  // Record the message to update it later
  nowAvailableRaspberryListLastStockMessagesKeys.forEach(raspberryKey => {
    const raspberryAvailable = new Map()
    raspberryListWithChanges.nowAvailableRaspberry.forEach(raspberry => {
      raspberryAvailable.set(raspberryKey, raspberry)
    })

    const messageContent = {
      telegramMessage: sentMsg,
      raspberryAvailable,
      raspberryUnavailable: new Map(),
    }
    lastStockMessagesIds.set(raspberryKey, sentMsg.message_id)
    lastStockMessagesContent.set(sentMsg.message_id, messageContent)

    // Delete key in 48 hours (avoid a dumb memory leak)
    setTimeout(() => {
      lastStockMessagesIds.delete(raspberryKey)
      lastStockMessagesContent.delete(sentMsg.message_id)
    }, 48 * 60 * 60 * 1000)
  })
}

const updateTelegramAlert = async (raspberryListWithChanges: ReturnType<typeof updateRapsberryCache>) => {
  for (const raspberry of raspberryListWithChanges.nowUnavailableRaspberry.values()) {
    const raspberryKey = getRaspberryKey(raspberry)
    if (lastStockMessagesIds.has(raspberryKey)) {
      console.log(`Now unavailable: ${raspberryKey}`)
      const message_id = lastStockMessagesIds.get(raspberryKey)!
      const lastMessageContent = lastStockMessagesContent.get(message_id)!
      lastMessageContent.raspberryAvailable.delete(raspberryKey)
      lastMessageContent.raspberryUnavailable.set(raspberryKey, raspberry)
      const raspberryAvailabilities = {
        nowAvailableRaspberry: lastMessageContent.raspberryAvailable,
        nowUnavailableRaspberry: lastMessageContent.raspberryUnavailable,
      }
      lastMessageContent.telegramMessage.text = getTelegramMessage(raspberryAvailabilities)
      await bot.editMessageText(lastMessageContent.telegramMessage.text, {
        chat_id: TELEGRAM_CHAT_ID,
        message_id: lastMessageContent.telegramMessage.message_id,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      })
    }
  }
}

const checkStock = async () => {
  if (process.env.NODE_ENV === 'development') console.log(debugRound)

  if (fetchErrorsSkipCyclesLeft > 0) {
    console.log(`Too many errors, skipping - errorsSkipCyclesLeft: ${fetchErrorsSkipCyclesLeft}`)
    fetchErrorsSkipCyclesLeft--
    return
  } else {
    // Just to make sure in case we have some wtf race condition
    fetchErrorsSkipCyclesLeft = 0
  }

  try {
    console.log('Checking stock...')

    // Do the request 2 times with a bit of delay and check the result is the same
    // Sometimes rpilocator returns invalid data (race condition when updating on their side)
    let [raspberryList, raspberryListDoubleCheck] = await Promise.all([
      getRaspberryList(),
      new Promise(resolve => setTimeout(() => resolve(getRaspberryList()), 5000)) as Promise<
        ReturnType<typeof getRaspberryList>
      >,
    ]).catch(async e => {
      fetchErrors.push(new Date())
      if (hasReachedErrorsSkipThresold()) {
        // Too many fetch errors in the time window, skip some fetch cycles
        const cyclesToSkip = ERRORS_SKIP_CYCLES()
        fetchErrorsSkipCyclesLeft = cyclesToSkip

        await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `⏳ Too many errors, skipping ${cyclesToSkip} check cycles!`)
      }
      throw e
    })

    // Check both requests were succesful
    if ((raspberryList && !raspberryListDoubleCheck) || (!raspberryList && raspberryListDoubleCheck)) {
      console.error('One of the double check requests failed')
      return
    }

    // Both requests failed, log error
    if (!raspberryList && !raspberryListDoubleCheck) {
      const timestamp = Date.now()
      const url = new URL(`invalid-both-requests-failed-${timestamp}.json`, import.meta.url)

      const raspberryListJson = JSON.stringify(raspberryList)
      writeFileSync(url, raspberryListJson)
      throw new Error(`Failed double check, both requests failed - Content:\n${raspberryListJson.slice(0, 1000)}`)
    }

    // Check both requests are indeed identical
    if (!areIdentical(raspberryList, raspberryListDoubleCheck)) {
      const timestamp = Date.now()
      if (process.env.NODE_ENV === 'development') {
        const url1 = new URL(`invalid-double-check-${timestamp}-1.json`, import.meta.url)
        const url2 = new URL(`invalid-double-check-${timestamp}-2.json`, import.meta.url)
        writeFileSync(url1, JSON.stringify(raspberryList, null, 2))
        writeFileSync(url2, JSON.stringify(raspberryListDoubleCheck, null, 2))
      }
      console.error('Detected invalid data when double checking')
      return
    }

    // Blacklist some vendors because they change their stock or price too often
    const blacklistedVendors = ['samm']
    raspberryList = raspberryList.filter(r => !blacklistedVendors.includes(r.vendor))

    const raspberryListWithChanges = updateRapsberryCache(raspberryList)

    // Cache it on file system for other checker instances and API endpoint
    if (!USE_CACHED_REQUEST) {
      const apiData = {
        lastUpdate: new Date(),
        _data: raspberryList,
      }
      writeFileSync(new URL('../_cached_request_data.json', import.meta.url), JSON.stringify(apiData, null, 2))
    }

    // console.log('nowAvailableRaspberry', raspberryListWithChanges.nowAvailableRaspberry)
    // console.log(raspberryListWithChanges)

    if (raspberryListWithChanges.nowAvailableRaspberry.size > 0) {
      await sendTelegramAlert(raspberryListWithChanges)
      if (process.env.NODE_ENV === 'development')
        writeFileSync(
          `now-available-${Date.now()}.json`,
          JSON.stringify([...raspberryAvailableCache.values()], null, 2)
        )
    } else {
      console.log('Not in stock!')
    }
    if (raspberryListWithChanges.nowUnavailableRaspberry.size > 0) {
      await updateTelegramAlert(raspberryListWithChanges)
    }
  } catch (error) {
    console.error(error)

    let stack = error.stack?.slice(0, 2000)
    if (error.message.includes('API data was not JSON!')) stack = 'API data was not JSON'

    await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `❌ Error!\n\`\`\`${stack}\`\`\``, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    })
  }
  debugRound++
}

const liveStockUpdate = async () => {
  if (!TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID) return

  let message = '🔴🤖 Live Raspberry Stock Update\n\n'

  const available = [...new Set([...raspberryAvailableCache.values()])]
    .filter(x => x.avail === 'Yes')
    .slice(0, 50) // Telegram message is too long if too many
    .map(r => `✅ ${getRaspberryLink(r)}`)
  message += available.length > 0 ? available.join('\n') : '🤷‍♀️ Nothing available right now'

  message += '\n\n🌟 Star on [GitHub](https://github.com/rigwild/raspberry-instock-check)'
  message += '\n🌐 Stock data from [rpilocator](https://rpilocator.com/?utm_source=telegram&utm_medium=rapsberry_alert)'
  message += `\n\n🔄 Last update at ${toHumanDateTime(new Date())}`

  await bot
    .editMessageText(message, {
      chat_id: TELEGRAM_CHAT_ID,
      message_id: TELEGRAM_LIVE_STOCK_UPDATE_MESSAGE_ID,
      parse_mode: 'Markdown',
    })
    .catch(error => {
      if (
        error.message.includes(
          'specified new message content and reply markup are exactly the same as a current content and reply markup of the message'
        )
      ) {
        return
      }
      console.error(error)
    })
}

;(process.env.NODE_ENV === 'test' || USE_CACHED_REQUEST ? Promise.resolve() : getRpilocatorTokenAndCookies())
  .then(checkStock)
  .finally(() => {
    liveStockUpdate()
    setInterval(checkStock, CHECK_INTERVAL + Math.random() * 3000)
    setInterval(liveStockUpdate, process.env.NODE_ENV === 'test' ? 2000 : 20_000)
    if (API_RUN) startServer()
  })
