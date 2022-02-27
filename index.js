// @ts-check
import fetch from 'node-fetch'
import { JSDOM } from 'jsdom'
import TelegramBot from 'node-telegram-bot-api'

const STOCK_URI = 'https://rpilocator.com/'
const RASPBERRY_MODELS = process.env.RASPBERRY_MODELS ? process.env.RASPBERRY_MODELS.split(',') : ['RPI4-MODBP-8GB']
const CHECK_INTERVAL = +process.env.CHECK_INTERVAL || 60_000

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

const bot = new TelegramBot(TELEGRAM_TOKEN)
bot.sendMessage(
  TELEGRAM_CHAT_ID,
  `Bot started! ⚡\nLooking for models:\n${RASPBERRY_MODELS.map(x => `\`${x}\``).join('\n')}`,
  { parse_mode: 'Markdown' }
)

const getHTML = async () => {
  const rawHTML = await fetch(STOCK_URI).then(res => res.text())
  const dom = new JSDOM(rawHTML)
  return dom.window.document
}

/** @param {Document} document */
const parseHTML = document => {
  return [...document.querySelectorAll('th')]
    .filter(x => RASPBERRY_MODELS.some(model => model === x.textContent.trim()))
    .map(x => x.parentElement)
    .filter(tr => tr.children[5].textContent.trim() === 'Yes')
    .map(tr => {
      const text = tr.textContent.trim().replace(/\n+/g, '\n').split('\n')
      return `[${text[1]} | ${text[3]} | ${text[5]}](${tr.querySelector('a')?.href})`
    })
}

/** @param {string[]} data */
const sendTelegramAlert = async data => {
  const message = `Raspberry in stock! 🔥\n${data.join('\n')}`
  console.log(message)
  await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
}

const checkStock = async () => {
  console.log('Checking stock...')
  const document = await getHTML()
  const data = parseHTML(document)
  if (data.length > 0) await sendTelegramAlert(data)
  else console.log('Not in stock!')
}

checkStock()
setInterval(checkStock, CHECK_INTERVAL)
